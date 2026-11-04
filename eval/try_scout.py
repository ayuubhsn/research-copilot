"""
Kjører Scout på noen spørsmål og viser hva den gjør, steg for steg.

Kjør fra prosjektmappen:
    python eval/try_scout.py
Loggene lagres også i eval/scout_runs.json.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model
from src.scout import run_scout

PDF = ROOT / "eval" / "papers" / "lost_in_the_middle.pdf"
OUT = ROOT / "eval" / "scout_runs.json"

QUESTIONS = [
    "How many queries are used in the multi-document QA experiments?",
    "Which phenomenon from psychology do the authors compare their results to?",
    "How many GPUs were used to run the experiments?",
]


def show(run):
    print("\n" + "=" * 70)
    print("Q:", run["question"])
    for step in run["trace"]:
        if step["type"] == "think":
            print(f"  [plan]   {step['text']}")
        elif step["type"] == "search":
            label = "WEAK" if step["weak"] else ("phrase" if step.get("phrase_found") else "ok  ")
            pages = ", ".join(f"p.{h['page']}" for h in step["hits"])
            print(f"  [search] {label} best={step['best']:.2f}  \"{step['query']}\"  -> {pages}")
        elif step["type"] == "check":
            for c in step["claims"]:
                mark = "ok " if c.get("supported") else "NO "
                print(f"  [check]  {mark} {c.get('claim', '')}")
        else:
            print(f"  [{step['type']}]")
    print(f"\nA ({run['searches']} searches{', gave up' if run['gave_up'] else ''}):")
    print(" ", run["answer"])


def main():
    pages, _ = extract_pages(PDF.read_bytes())
    chunks = chunk_pages(pages, source=PDF.name)
    model = load_embedding_model()
    index = create_faiss_index(create_embeddings(chunks, model))

    runs = []
    for question in QUESTIONS:
        run = run_scout(question, model, index, chunks)
        show(run)
        runs.append({k: v for k, v in run.items() if k != "passages"})

    OUT.write_text(json.dumps(runs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
