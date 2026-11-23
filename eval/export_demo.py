"""
Lager dataene til demo-modusen i web-appen.

Kjører pipelinen på én artikkel og noen spørsmål, og lagrer alt appen
trenger: sidetekst, tekstbiter med plassering på siden (for gul markering),
kunnskapskart, kildeinfo, svar fra vanlig RAG med faktasjekk, og Scouts
steg. Demo-modusen spiller av disse kjøringene, så den trenger verken
backend eller API-nøkkel.

Kjør fra prosjektmappen:
    python eval/export_demo.py <artikkel.pdf> <spørsmål.txt>
        Lagres lokalt i web/public/demo/ (gitignored), for å prøve demoen selv.

    python eval/export_demo.py <artikkel.pdf> <spørsmål.txt> --publish "CC BY 4.0"
        Lagres i site/demo/, som publiseres på nettsiden. Bruk bare artikler
        med en åpen lisens, siden både PDF-en og teksten blir offentlige.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pymupdf

from api.locate import locate
from api.metadata import lookup
from src.chunking import chunk_pages
from src.fact_check import check_answer
from src.knowledge_map import build_map, place_question
from src.llm import generate_answer
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks
from src.scout import run_scout

LOCAL = ROOT / "web" / "public" / "demo"
PUBLIC = ROOT / "site" / "demo"
TOP_K = 5


def locate_claims(claims, pdf, pages):
    """Finner sitatet som støtter hver påstand på en av kildesidene."""
    located = []
    for claim in claims:
        found = {**claim, "page": None, "rects": []}
        for page in dict.fromkeys(pages):
            rects = locate(pdf[page - 1], claim.get("evidence") or "") if claim.get("evidence") else []
            if rects:
                found = {**claim, "page": page, "rects": rects}
                break
        located.append(found)
    return located


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf")
    parser.add_argument("questions")
    parser.add_argument("--publish", metavar="LICENSE", help='lisensen til artikkelen, f.eks. "CC BY 4.0"')
    args = parser.parse_args()

    pdf_path = Path(args.pdf).resolve()
    questions = [q.strip() for q in Path(args.questions).read_text(encoding="utf-8-sig").splitlines() if q.strip()]
    out = PUBLIC if args.publish else LOCAL
    pdf_bytes = pdf_path.read_bytes()

    pages, page_count = extract_pages(pdf_bytes)
    chunks = chunk_pages(pages, source=pdf_path.name)
    model = load_embedding_model()
    embeddings = create_embeddings(chunks, model)
    index = create_faiss_index(embeddings)
    print(f"{pdf_path.name}: {page_count} sider, {len(chunks)} biter, {len(questions)} spørsmål")

    citation = lookup(pdf_bytes, pages, pdf_path.name)
    print(f"Kildeinfo ({citation['source']}): {citation['title']} ({citation['year']})")

    map_model = build_map(embeddings, chunks)
    points = [
        {"x": p["x"], "y": p["y"], "island": p["island"], "page": chunks[i]["page_number"]}
        for i, p in enumerate(map_model["points"])
    ]

    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        # Plasseringen av hver tekstbit på siden, så demoen kan markere uten backend
        chunk_rects = [locate(pdf[c["page_number"] - 1], c["text"]) for c in chunks]

        runs = []
        for n, question in enumerate(questions, 1):
            print(f"  [{n}/{len(questions)}] {question}")

            # Vanlig RAG: ett søk, svar, faktasjekk
            results = search_chunks(question, model, index, chunks, top_k=TOP_K)
            draft = generate_answer(question, results)
            checked = check_answer(question, draft, results)

            # Scout: agenten søker selv, og hvert steg logges
            scout = run_scout(question, model, index, chunks, top_k=TOP_K, check=True)
            for step in scout["trace"]:
                if step["type"] == "check":
                    step["claims"] = locate_claims(step["claims"], pdf, [r["page_number"] for r in scout["passages"]])

            hits = [r["chunk"] for r in results]
            position = place_question(map_model["points"], hits[:3], [r["score"] for r in results[:3]])

            runs.append(
                {
                    "question": question,
                    "position": position,
                    "rag": {
                        "answer": checked["answer"],
                        "draft": draft,
                        "claims": locate_claims(checked["claims"], pdf, [r["page_number"] for r in results]),
                        "removed": checked["removed"],
                        "partial": checked.get("partial", 0),
                        "sources": [
                            {
                                "chunk": r["chunk"],
                                "page": r["page_number"],
                                "score": round(r["score"], 3),
                                "phrase_match": r["phrase_match"],
                                "text": r["text"],
                                "rects": chunk_rects[r["chunk"]],
                            }
                            for r in results
                        ],
                    },
                    "scout": {
                        "answer": scout["answer"],
                        "searches": scout["searches"],
                        "gave_up": scout["gave_up"],
                        "trace": scout["trace"],
                    },
                }
            )

    data = {
        "paper": {
            "file": pdf_path.name,
            "page_count": page_count,
            "pages": [{"page": p["page_number"], "text": p["text"]} for p in pages],
            "citation": citation,
            "license": args.publish,
            "pdf": "paper.pdf",
        },
        "chunks": [{"page": c["page_number"], "text": c["text"], "rects": chunk_rects[i]} for i, c in enumerate(chunks)],
        "map": {"points": points, "islands": map_model["islands"]},
        "runs": runs,
    }

    out.mkdir(parents=True, exist_ok=True)
    (out / "demo_data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    shutil.copyfile(pdf_path, out / "paper.pdf")
    print(f"Lagret {(out / 'demo_data.json').relative_to(ROOT)} og paper.pdf")
    if args.publish:
        print(f"Publiseres med nettsiden. Lisens: {args.publish}. Husk å oppgi forfatterne og kilden.")


if __name__ == "__main__":
    main()
