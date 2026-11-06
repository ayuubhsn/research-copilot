"""
Lager dataene til demo-modusen i web-appen.

Kjører pipelinen på én artikkel og noen spørsmål, og lagrer alt appen
trenger i én JSON-fil: sidetekst, kunnskapskart, svar fra vanlig RAG med
faktasjekk, og Scouts steg. Demo-modusen spiller av disse kjøringene, så
den trenger verken backend eller API-nøkkel.

Bruk bare artikler med en lisens som tillater gjenbruk (f.eks. CC BY),
siden sideteksten publiseres sammen med siden.

Kjør fra prosjektmappen:
    python eval/export_demo.py eval/papers/demo.pdf eval/demo_questions.txt
Resultatet lagres i web/public/demo/demo_data.json, der Next.js-appen leser det.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.fact_check import check_answer
from src.knowledge_map import build_map, place_question
from src.llm import generate_answer
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks
from src.scout import run_scout

OUT = ROOT / "web" / "public" / "demo" / "demo_data.json"
TOP_K = 5


def main():
    if len(sys.argv) < 3:
        sys.exit("Bruk: python eval/export_demo.py <artikkel.pdf> <spørsmål.txt>")
    pdf = Path(sys.argv[1]).resolve()
    questions = [q.strip() for q in Path(sys.argv[2]).read_text(encoding="utf-8-sig").splitlines() if q.strip()]

    pages, page_count = extract_pages(pdf.read_bytes())
    chunks = chunk_pages(pages, source=pdf.name)
    model = load_embedding_model()
    embeddings = create_embeddings(chunks, model)
    index = create_faiss_index(embeddings)
    print(f"{pdf.name}: {page_count} sider, {len(chunks)} biter, {len(questions)} spørsmål")

    map_model = build_map(embeddings, chunks)
    points = [
        {"x": p["x"], "y": p["y"], "island": p["island"], "page": chunks[i]["page_number"]}
        for i, p in enumerate(map_model["points"])
    ]

    runs = []
    for n, question in enumerate(questions, 1):
        print(f"  [{n}/{len(questions)}] {question}")

        # Vanlig RAG: ett søk, svar, faktasjekk
        results = search_chunks(question, model, index, chunks, top_k=TOP_K)
        draft = generate_answer(question, results)
        checked = check_answer(question, draft, results, mode="basic")

        # Scout: agenten søker selv, og hvert steg logges
        scout = run_scout(question, model, index, chunks, top_k=TOP_K, check=True)

        hits = [r["chunk"] for r in results]
        position = place_question(map_model["points"], hits[:3], [r["score"] for r in results[:3]])

        runs.append(
            {
                "question": question,
                "position": position,
                "rag": {
                    "answer": checked["answer"],
                    "draft": draft,
                    "claims": checked["claims"],
                    "removed": checked["removed"],
                    "sources": [
                        {
                            "chunk": r["chunk"],
                            "page": r["page_number"],
                            "score": round(r["score"], 3),
                            "phrase_match": r["phrase_match"],
                            "text": r["text"],
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
            "file": pdf.name,
            "page_count": page_count,
            "pages": [{"page": p["page_number"], "text": p["text"]} for p in pages],
        },
        "chunks": [{"page": c["page_number"], "text": c["text"]} for c in chunks],
        "map": {"points": points, "islands": map_model["islands"]},
        "runs": runs,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Lagret {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
