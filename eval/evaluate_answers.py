"""
Evaluering av svarene: sammenligner hvert svar med fasiten i questions.csv.

evaluate.py måler om søket finner riktig side. Dette skriptet måler om
SVARET er riktig. Hvert spørsmål kjøres gjennom både vanlig RAG (ett søk)
og Scout (agenten), og GPT vurderer svaret mot fasiten som en sensor.

Kjør fra prosjektmappen:
    python eval/evaluate_answers.py
"""

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.fact_check import check_answer
from src.llm import client, generate_answer
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks
from src.scout import run_scout

EVAL_DIR = ROOT / "eval"
# Standard er det offentlige kontrollsettet. Et annet testsett kan gis som argument,
# f.eks. et privat testsett som ikke ligger i repoet: python eval/evaluate.py eval/questions.csv
QUESTIONS_FILE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else EVAL_DIR / "control_questions.csv"
RESULTS_FILE = EVAL_DIR / "answer_results.csv"
JUDGE_MODEL = "gpt-4o-mini"

POINTS = {"correct": 1.0, "partial": 0.5, "wrong": 0.0}

JUDGE_PROMPT = """You are grading answers from a question-answering system about a research paper.

Step 1. Split the expected answer into its key facts: short, separate claims such as a name, a number,
a year, or one item of a list. Use 1 fact for a simple answer and one fact per item for a list.
Anything inside [optional: ...] is background, not a key fact: leave it out of the list.

Step 2. For each key fact, check the system answer:
- "present": the answer states this fact, in any wording
- "missing": the answer does not state it
- "contradicted": the answer states something that conflicts with it

Ignore everything else in the system answer. Length and extra details never matter.

Reply with JSON only:
{"facts": [{"fact": "<key fact>", "status": "present" | "missing" | "contradicted"}]}"""

UNANSWERABLE_PROMPT = """A question-answering system was asked a question whose answer is NOT in the paper.
Did the system make clear that the requested information is not available, without inventing it?
Mentioning related context is fine, as long as the requested fact itself (for example a name or a
number) is not stated.

Reply with JSON only: {"said_not_available": true | false, "reason": "<one short sentence>"}"""


def ask_json(system_prompt, content):
    response = client.chat.completions.create(
        model=JUDGE_MODEL,
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": content}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return json.loads(response.choices[0].message.content)


def judge(question, expected, answer, answerable):
    """Vurderer svaret mot fasiten, faktum for faktum.

    I stedet for én helhetsvurdering deles fasiten opp i konkrete fakta, og hvert
    faktum sjekkes for seg. Karakteren regnes ut i koden, ikke av GPT, så den blir
    mer stabil og mindre påvirket av hvor langt svaret er.
    """
    if not answerable:
        result = ask_json(
            UNANSWERABLE_PROMPT,
            f"Question: {question}\nWhy it is not answerable: {expected}\nSystem answer: {answer}",
        )
        ok = bool(result.get("said_not_available"))
        return ("correct" if ok else "wrong"), result.get("reason", ""), ""

    result = ask_json(JUDGE_PROMPT, f"Question: {question}\nExpected answer: {expected}\nSystem answer: {answer}")
    facts = result.get("facts") or []
    statuses = [f.get("status", "missing") for f in facts]
    present = statuses.count("present")

    if not facts or present == 0:
        verdict = "wrong"
    elif present == len(facts) and "contradicted" not in statuses:
        verdict = "correct"
    else:
        verdict = "partial"

    checklist = "; ".join(f"{f.get('status', '?')}: {f.get('fact', '')}" for f in facts)
    return verdict, f"{present}/{len(facts)} key facts present", checklist


def cited_pages(answer):
    """Finner sidetallene svaret viser til, f.eks. "page 22" eller "Side 22"."""
    return {int(p) for p in re.findall(r"(?:page|side|p\.)\s*(\d+)", answer or "", flags=re.IGNORECASE)}


def main():
    with open(QUESTIONS_FILE, encoding="utf-8") as f:
        questions = list(csv.DictReader(f))

    model = load_embedding_model()
    chunks = []
    for source in sorted({q["source"] for q in questions}):
        pages, _ = extract_pages((EVAL_DIR / "papers" / source).read_bytes())
        chunks.extend(chunk_pages(pages, source=source))
    index = create_faiss_index(create_embeddings(chunks, model))
    print(f"{len(chunks)} chunks, {len(questions)} questions, 2 systems\n")

    rows = []
    for n, q in enumerate(questions, 1):
        answerable = q["expected_page"] != "none"
        expected_pages = set() if not answerable else {int(p) for p in q["expected_page"].split("|")}

        # Vanlig RAG: ett søk, de fem beste treffene til GPT
        rag_results = search_chunks(q["question"], model, index, chunks, top_k=5)
        rag_answer = generate_answer(q["question"], rag_results)
        # Scout: agenten bestemmer selv hvor mange søk den trenger (uten faktasjekk først)
        scout_run = run_scout(q["question"], model, index, chunks, check=False)
        # Faktasjekk av de samme svarene, så vi ser nøyaktig hva sjekken endrer
        rag_checked = check_answer(q["question"], rag_answer, rag_results)
        scout_checked = check_answer(q["question"], scout_run["answer"], scout_run["passages"])

        systems = [
            ("rag", rag_answer, 1, ""),
            ("rag+check", rag_checked["answer"], 1, rag_checked["removed"]),
            ("scout", scout_run["answer"], scout_run["searches"], ""),
            ("scout+check", scout_checked["answer"], scout_run["searches"], scout_checked["removed"]),
        ]
        line = []
        for system, answer, searches, removed in systems:
            verdict, reason, checklist = judge(q["question"], q["expected_answer"], answer, answerable)
            cites = cited_pages(answer)
            rows.append(
                {
                    "type": q["type"],
                    "question": q["question"],
                    "system": system,
                    "verdict": verdict,
                    "reason": reason,
                    "checklist": checklist,
                    "cited_right_page": bool(cites & expected_pages) if answerable else "",
                    "searches": searches,
                    "claims_removed": removed,
                    "answer": answer,
                }
            )
            line.append(f"{system}={verdict:<8}")
        print(f"[{n:2}/{len(questions)}] {' '.join(line)} {q['question'][:45]}")

    # Sammendrag: poeng per type og system (riktig = 1, delvis = 0,5)
    names = [name for name, *_ in systems]
    print("\n" + "=" * 78)
    print(f"{'Type':<12}{'Antall':>7}" + "".join(f"{name:>14}" for name in names))
    groups = defaultdict(lambda: defaultdict(list))
    for row in rows:
        groups[row["type"]][row["system"]].append(row)
        groups["TOTALT"][row["system"]].append(row)

    order = [g for g in groups if g != "TOTALT"] + ["TOTALT"]
    for name in order:
        count = len(groups[name]["rag"])
        scores = [sum(POINTS[r["verdict"]] for r in groups[name][system]) for system in names]
        print(f"{name:<12}{count:>7}" + "".join(f"{score:>10.1f}/{count:<3}" for score in scores))

    for system in ("rag+check", "scout+check"):
        removed = sum(r["claims_removed"] or 0 for r in groups["TOTALT"][system])
        changed = sum(1 for r in groups["TOTALT"][system] if r["claims_removed"])
        print(f"\n{system}: fjernet {removed} påstander i {changed} svar")
    print("\nRiktig = 1 poeng, delvis = 0,5. Ubesvarbare: riktig betyr at systemet sa at svaret mangler.")

    with open(RESULTS_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"Detaljer, inkludert begrunnelse for hver vurdering: {RESULTS_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
