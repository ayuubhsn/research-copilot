"""
Evaluering av søket i ResearchCopilot.

Kjører alle spørsmålene i eval/questions.csv gjennom den samme søkepipelinen
som appen bruker (PDF -> chunks -> embeddings -> FAISS), og måler om riktig
side havner blant treffene. Trenger ingen OpenAI-nøkkel.

Kjør fra prosjektmappen:
    python eval/evaluate.py
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

# Gjør det mulig å importere src/ når skriptet kjøres fra eval/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks

EVAL_DIR = ROOT / "eval"
PAPERS_DIR = EVAL_DIR / "papers"
# Standard er det offentlige kontrollsettet. Et annet testsett kan gis som argument,
# f.eks. et privat testsett som ikke ligger i repoet: python eval/evaluate.py eval/questions.csv
QUESTIONS_FILE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else EVAL_DIR / "control_questions.csv"
RESULTS_FILE = EVAL_DIR / "results.csv"

TOP_K = 5  # samme standardverdi som slideren i appen


def load_questions():
    with open(QUESTIONS_FILE, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_index(sources, model):
    """Leser alle PDF-ene spørsmålene viser til og lager én felles indeks."""
    all_chunks = []
    for source in sorted(sources):
        pdf_path = PAPERS_DIR / source
        if not pdf_path.exists():
            sys.exit(f"Fant ikke {pdf_path}. Legg PDF-en i eval/papers/.")
        pages, _ = extract_pages(pdf_path.read_bytes())
        all_chunks.extend(chunk_pages(pages, source=source))

    embeddings = create_embeddings(all_chunks, model)
    return all_chunks, create_faiss_index(embeddings)


def main():
    questions = load_questions()
    model = load_embedding_model()
    chunks, index = build_index({q["source"] for q in questions}, model)
    print(f"{len(chunks)} chunks indeksert, {len(questions)} spørsmål\n")

    rows = []
    for q in questions:
        results = search_chunks(q["question"], model, index, chunks, top_k=TOP_K)
        pages = [r["page_number"] for r in results]
        top_score = results[0]["score"] if results else 0.0

        if q["expected_page"] == "none":
            # Ubesvarbart spørsmål: ingen side er "riktig". Vi logger hvor
            # sikker søket var, for å se om en terskel kunne fanget det opp.
            rank = None
        else:
            expected = {int(p) for p in q["expected_page"].split("|")}
            rank = next((i + 1 for i, p in enumerate(pages) if p in expected), None)

        rows.append({**q, "retrieved_pages": "|".join(map(str, pages)),
                     "rank": rank or "", "top_score": round(top_score, 3)})

        status = "–" if q["expected_page"] == "none" else ("OK " if rank else "BOM")
        print(f"[{status}] {q['type']:<11} rank={rank or '-':<2} "
              f"score={top_score:.2f}  {q['question'][:60]}")

    # Sammendrag per spørsmålstype
    print("\n" + "=" * 60)
    print(f"{'Type':<12}{'Antall':>7}{'Treff@1':>10}{'Treff@5':>10}{'MRR':>8}")
    groups = defaultdict(list)
    for r in rows:
        if r["expected_page"] != "none":
            groups[r["type"]].append(r)
            groups["TOTALT"].append(r)

    order = [g for g in groups if g != "TOTALT"] + ["TOTALT"]
    for name in order:
        group = groups[name]
        n = len(group)
        hit1 = sum(1 for r in group if r["rank"] == 1)
        hit5 = sum(1 for r in group if r["rank"])
        mrr = sum(1 / r["rank"] for r in group if r["rank"]) / n
        print(f"{name:<12}{n:>7}{hit1:>7}/{n:<2}{hit5:>7}/{n:<2}{mrr:>8.2f}")

    answerable = [r["top_score"] for r in rows if r["expected_page"] != "none"]
    unanswerable = [r["top_score"] for r in rows if r["expected_page"] == "none"]
    if unanswerable:
        print(f"\nSnittscore besvarbare:   {sum(answerable) / len(answerable):.2f}")
        print(f"Snittscore ubesvarbare:  {sum(unanswerable) / len(unanswerable):.2f}")
        print("(Stor forskjell betyr at en terskel kan få appen til å si 'vet ikke'.)")

    with open(RESULTS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nDetaljer lagret i {RESULTS_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
