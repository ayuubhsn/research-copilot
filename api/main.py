"""
ResearchCopilot API: gjør Python-pipelinen tilgjengelig for Next.js-appen.

Start fra prosjektmappen:
    uvicorn api.main:app --reload
Dokumentasjon for alle endepunktene: http://localhost:8000/docs
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import pymupdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.locate import locate, locate_words
from api import metadata
from api.notebook import Notebook
from api.store import Store, UploadError
from src.fact_check import check_answer
from src.knowledge_map import place_question
from src.llm import generate_answer
from src.rag import load_embedding_model, search_chunks
from src.scout import run_scout

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("RC_DATA_DIR", ROOT / "api" / "data"))
CORS_ORIGINS = os.getenv("RC_CORS_ORIGINS", "http://localhost:3000").split(",")
TOP_K = 5

state = {}


@asynccontextmanager
async def lifespan(app):
    # Embedding-modellen lastes én gang og deles av alle forespørsler
    state["store"] = Store(DATA_DIR, load_embedding_model())
    state["notebook"] = Notebook(DATA_DIR)
    yield
    state.clear()


app = FastAPI(title="ResearchCopilot API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def store() -> Store:
    return state["store"]


def notebook() -> Notebook:
    return state["notebook"]


def get_doc(doc_id):
    doc = store().get(doc_id)
    if doc is None:
        raise HTTPException(404, "No document with that id.")
    return doc


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    mode: Literal["fast", "scout"] = "fast"


class Author(BaseModel):
    family: str
    given: str = ""


class Citation(BaseModel):
    title: str
    authors: list[Author] = []
    year: int | None = None
    container: str = ""
    volume: str = ""
    issue: str = ""
    pages: str = ""
    doi: str | None = None
    type: Literal["article", "preprint", "conference", "book", "chapter", "report"] = "article"
    publisher: str = ""
    source: str = "user"


class NoteRequest(BaseModel):
    docId: str
    page: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=5000)
    note: str = ""
    tags: list[str] = []


class NoteUpdate(BaseModel):
    note: str | None = None
    tags: list[str] | None = None


@app.get("/health")
def health():
    return {"ok": True, "documents": len(store().all())}


@app.get("/documents")
def list_documents():
    return [doc.info() for doc in store().all()]


@app.post("/documents", status_code=201)
def upload(file: UploadFile = File(...)):
    # En vanlig def-funksjon kjøres i en egen tråd, så indekseringen blokkerer ikke serveren
    try:
        doc = store().add(file.file.read(), file.filename or "document.pdf")
    except UploadError as error:
        raise HTTPException(400, str(error)) from error
    return doc.info()


@app.delete("/documents/{doc_id}", status_code=204)
def delete(doc_id: str):
    if not store().delete(doc_id):
        raise HTTPException(404, "No document with that id.")
    notebook().delete_document(doc_id)


class LookupRequest(BaseModel):
    doi: str | None = None
    title: str | None = None


@app.post("/documents/{doc_id}/citation/lookup")
def lookup_citation(doc_id: str, request: LookupRequest):
    """Henter kildeinfo fra en DOI, eller søker opp en tittel. Lagrer ingenting; brukeren ser over først."""
    get_doc(doc_id)
    doi = (request.doi or "").strip().removeprefix("https://doi.org/").removeprefix("doi:").strip() or None
    if not doi and request.title:
        doi = metadata.search_title(request.title)
    found = metadata.citation_for_doi(doi) if doi else None
    if found is None:
        raise HTTPException(404, "Found nothing for that DOI or title, or the register could not be reached.")
    return found


@app.put("/documents/{doc_id}/citation")
def update_citation(doc_id: str, citation: Citation):
    """Brukeren retter opp kildeinfo (forfattere, år, tittel ...) for referansene."""
    get_doc(doc_id)
    return store().set_citation(doc_id, {**citation.model_dump(), "source": "user"}).info()


@app.get("/search")
def search(q: str, limit: int = 12, docs: str | None = None):
    """Finn igjen: hybridsøk i hele biblioteket, uten språkmodell. Raskt og gratis."""
    query = q.strip()
    if not query:
        return []
    wanted = set(docs.split(",")) if docs else None
    hits = []
    for doc in store().all():
        if wanted and doc.id not in wanted:
            continue
        for r in search_chunks(query, store().model, doc.index, doc.chunks, top_k=limit):
            # Eksakte ord teller litt ekstra: det er ofte det man husker
            rank = r["score"] + (0.15 if r["phrase_match"] else 0) + min(r["keyword_score"], 10) * 0.01
            hits.append((rank, doc, r))
    hits.sort(key=lambda h: h[0], reverse=True)

    results = []
    pdfs = {}
    for rank, doc, r in hits[:limit]:
        pdf = pdfs.setdefault(doc.id, pymupdf.open(doc.pdf_path))
        results.append(
            {
                "docId": doc.id,
                "chunk": r["chunk"],
                "page": r["page_number"],
                "score": round(r["score"], 3),
                "rank": round(rank, 3),
                "text": r["text"],
                "rects": locate(pdf[r["page_number"] - 1], r["text"]),
            }
        )
    for pdf in pdfs.values():
        pdf.close()
    return results


@app.get("/notebook")
def list_notes():
    return notebook().all()


@app.post("/notebook", status_code=201)
def add_note(request: NoteRequest):
    doc = get_doc(request.docId)
    if request.page > doc.page_count:
        raise HTTPException(400, "That page does not exist in the document.")
    with pymupdf.open(doc.pdf_path) as pdf:
        # Lagre hele ord, også når markeringen startet eller sluttet midt i et ord
        rects, text = locate_words(pdf[request.page - 1], request.text)
    return notebook().add(request.docId, request.page, text, rects, request.note, request.tags)


@app.patch("/notebook/{note_id}")
def update_note(note_id: str, request: NoteUpdate):
    entry = notebook().update(note_id, request.note, request.tags)
    if entry is None:
        raise HTTPException(404, "No note with that id.")
    return entry


@app.delete("/notebook/{note_id}", status_code=204)
def delete_note(note_id: str):
    if not notebook().delete(note_id):
        raise HTTPException(404, "No note with that id.")


@app.get("/documents/{doc_id}/file")
def pdf_file(doc_id: str):
    doc = get_doc(doc_id)
    return FileResponse(doc.pdf_path, media_type="application/pdf", filename=doc.file)


@app.get("/documents/{doc_id}/pages")
def pages(doc_id: str):
    return [{"page": p["page_number"], "text": p["text"]} for p in get_doc(doc_id).pages]


@app.get("/documents/{doc_id}/chunks")
def chunks(doc_id: str):
    return [{"page": c["page_number"], "text": c["text"]} for c in get_doc(doc_id).chunks]


@app.get("/documents/{doc_id}/map")
def knowledge_map(doc_id: str):
    return get_doc(doc_id).map


@app.post("/documents/{doc_id}/ask")
def ask(doc_id: str, request: AskRequest):
    doc = get_doc(doc_id)
    question = request.question.strip()

    if request.mode == "fast":
        results = search_chunks(question, store().model, doc.index, doc.chunks, top_k=TOP_K)
        checked = check_answer(question, generate_answer(question, results), results)
        answer, claims, removed, partial = checked["answer"], checked["claims"], checked["removed"], checked["partial"]
        gave_up, searches, trace = False, 1, []
    else:
        scout = run_scout(question, store().model, doc.index, doc.chunks, top_k=TOP_K, check=True)
        results = sorted(scout["passages"], key=lambda r: r["score"], reverse=True)
        check = next((s for s in scout["trace"] if s["type"] == "check"), None)
        answer, gave_up, searches, trace = scout["answer"], scout["gave_up"], scout["searches"], scout["trace"]
        claims, removed, partial = (check["claims"], check["removed"], check.get("partial", 0)) if check else ([], 0, 0)

    with pymupdf.open(doc.pdf_path) as pdf:
        sources = [
            {
                "chunk": r["chunk"],
                "page": r["page_number"],
                "score": round(r["score"], 3),
                "phrase_match": r.get("phrase_match", False),
                "text": r["text"],
                "rects": locate(pdf[r["page_number"] - 1], r["text"]),
            }
            for r in results
        ]
        claims = [locate_claim(claim, pdf, sources) for claim in claims]

    position = None
    if doc.map["points"] and sources:
        top = sources[:3]
        position = place_question(doc.map["points"], [s["chunk"] for s in top], [s["score"] for s in top])

    return {
        "question": question,
        "mode": request.mode,
        "answer": answer,
        "claims": claims,
        "removed": removed,
        "partial": partial,
        "gaveUp": gave_up,
        "searches": searches,
        "sources": sources,
        "trace": trace,
        "position": position,
    }


def locate_claim(claim, pdf, sources):
    """Finner sitatet som støtter en påstand, så akkurat den setningen kan markeres i PDF-en."""
    evidence = claim.get("evidence") or ""
    for page in dict.fromkeys(s["page"] for s in sources):
        rects = locate(pdf[page - 1], evidence) if evidence else []
        if rects:
            return {**claim, "page": page, "rects": rects}
    return {**claim, "page": None, "rects": []}
