"""
Lagring av opplastede PDF-er og alt som er regnet ut for dem.

Hver PDF får en mappe under data-mappen med originalfilen, sidetekst,
tekstbiter, embeddings og kunnskapskart. Da overlever dokumentene en
omstart av serveren, og ingenting må regnes ut på nytt. FAISS-indeksen
bygges fra de lagrede embeddings ved oppstart, siden det går raskt.
"""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pymupdf

from api.metadata import lookup
from src.chunking import chunk_pages
from src.knowledge_map import build_map
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index

MAX_MB = 25
MAX_PAGES = 80
MIN_CHUNKS_FOR_MAP = 8  # UMAP trenger noen punkter for å gi et meningsfullt kart


class UploadError(ValueError):
    """En opplasting som ikke kan brukes, med en melding brukeren kan lese."""


@dataclass
class Document:
    id: str
    file: str
    page_count: int
    pages: list
    chunks: list
    embeddings: np.ndarray
    index: object
    map: dict
    folder: Path
    citation: dict

    @property
    def pdf_path(self):
        return self.folder / "original.pdf"

    def info(self):
        return {
            "id": self.id,
            "file": self.file,
            "pageCount": self.page_count,
            "passages": len(self.chunks),
            "citation": self.citation,
        }


class Store:
    def __init__(self, folder, model):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.model = model
        self.docs = {}
        for doc_folder in sorted(self.folder.iterdir()):
            if (doc_folder / "meta.json").exists():
                doc = self._load(doc_folder)
                self.docs[doc.id] = doc

    def get(self, doc_id):
        return self.docs.get(doc_id)

    def all(self):
        return list(self.docs.values())

    def add(self, pdf_bytes, filename):
        if len(pdf_bytes) > MAX_MB * 1024 * 1024:
            raise UploadError(f"The file is larger than {MAX_MB} MB.")
        try:
            with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
                page_count = len(pdf)
        except Exception as error:
            raise UploadError("That file could not be read as a PDF.") from error
        if page_count > MAX_PAGES:
            raise UploadError(f"The PDF has {page_count} pages; the limit is {MAX_PAGES}.")

        # Samme fil to ganger gir samme id, så den lagres bare én gang
        doc_id = hashlib.sha256(pdf_bytes).hexdigest()[:12]
        if doc_id in self.docs:
            return self.docs[doc_id]

        pages, page_count = extract_pages(pdf_bytes)
        chunks = chunk_pages(pages, source=filename)
        if not chunks:
            raise UploadError("No text found in the PDF. Scanned PDFs without a text layer are not supported yet.")

        citation = lookup(pdf_bytes, pages, filename)
        embeddings = create_embeddings(chunks, self.model)
        knowledge_map = build_map(embeddings, chunks) if len(chunks) >= MIN_CHUNKS_FOR_MAP else {"points": [], "islands": []}

        folder = self.folder / doc_id
        folder.mkdir(exist_ok=True)
        (folder / "original.pdf").write_bytes(pdf_bytes)
        meta = {"id": doc_id, "file": filename, "page_count": page_count, "citation": citation}
        (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        (folder / "pages.json").write_text(json.dumps(pages, ensure_ascii=False))
        (folder / "chunks.json").write_text(json.dumps(chunks, ensure_ascii=False))
        (folder / "map.json").write_text(json.dumps(knowledge_map))
        np.save(folder / "embeddings.npy", embeddings)

        doc = Document(
            doc_id, filename, page_count, pages, chunks, embeddings, create_faiss_index(embeddings), knowledge_map, folder, citation
        )
        self.docs[doc_id] = doc
        return doc

    def set_citation(self, doc_id, citation):
        doc = self.docs[doc_id]
        doc.citation = citation
        meta = json.loads((doc.folder / "meta.json").read_text())
        meta["citation"] = citation
        (doc.folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        return doc

    def delete(self, doc_id):
        doc = self.docs.pop(doc_id, None)
        if doc:
            for f in doc.folder.iterdir():
                f.unlink()
            doc.folder.rmdir()
        return doc is not None

    def _load(self, folder):
        meta = json.loads((folder / "meta.json").read_text())
        embeddings = np.load(folder / "embeddings.npy")
        pages = json.loads((folder / "pages.json").read_text())
        if "citation" not in meta:
            # Lastet opp før kildeinfo fantes: slå den opp nå og lagre den
            meta["citation"] = lookup((folder / "original.pdf").read_bytes(), pages, meta["file"])
            (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
        return Document(
            id=meta["id"],
            file=meta["file"],
            page_count=meta["page_count"],
            pages=pages,
            chunks=json.loads((folder / "chunks.json").read_text()),
            embeddings=embeddings,
            index=create_faiss_index(embeddings),
            map=json.loads((folder / "map.json").read_text()),
            folder=folder,
            citation=meta["citation"],
        )
