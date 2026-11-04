"""
Test av faktasjekken med plantede feil.

Riktige svar får én feil plantet med vilje, og så måler vi hvor mange av
feilene faktasjekken fanger. Vi sjekker også de riktige svarene, for å se
om faktasjekken fjerner påstander den ikke burde fjerne.

Tre typer feil:
- number:   et tall, en dato eller en prosent er endret
- entity:   et navn er byttet med et annet navn fra artikkelen
- stitched: to sanne fakta om forskjellige ting er limt sammen til én feil påstand

Kjør fra prosjektmappen:
    python eval/evaluate_fact_check.py

De plantede feilene lagres i eval/planted_errors.json og gjenbrukes, så
begge versjonene av faktasjekken testes på nøyaktig de samme svarene.
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.fact_check import PROMPTS, check_answer
from src.llm import client, generate_answer
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks, unique_contexts

EVAL_DIR = ROOT / "eval"
# Standard er det offentlige kontrollsettet; et annet testsett kan gis som argument
QUESTIONS_FILE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else EVAL_DIR / "control_questions.csv"
PLANTED_FILE = EVAL_DIR / "planted_errors.json"
MODEL = "gpt-4o-mini"
ERROR_TYPES = ["number", "entity", "stitched"]

PLANT_PROMPT = """You help test a fact checker. You get a correct answer about a research paper and the
source passages. Rewrite the answer so that it contains exactly ONE false claim of the requested type.
Keep everything else unchanged, including the citations. The false claim must sound natural and plausible.

Types:
- number: change one number, date or percentage to a wrong value
- entity: replace one name (a company, person, product or concept) with a different name that
  also appears in the passages
- stitched: combine two facts that are each true but about different things into one false claim,
  for example attach the reason or outcome of one event to another event

If the answer has nothing that fits the requested type, reply {"skip": true}.
Otherwise reply with JSON only: {"answer": "<rewritten answer>", "false_claim": "<the false claim>"}"""

CAUGHT_PROMPT = """A fact checker reviewed an answer that contained one planted false claim.
Did the checker flag that false claim as not supported?

Reply with JSON only: {"caught": true | false}"""


def ask_json(system_prompt, content, temperature=0):
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": content}],
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    return json.loads(response.choices[0].message.content)


def passages_text(results):
    return "\n\n".join(f"[{r['source']}, page {r['page_number']}]\n{r['context']}" for r in unique_contexts(results))


def build_planted_set(questions, model, index, chunks):
    """Lager riktige svar og plantede feil. Lagres, så testen kan kjøres på nytt."""
    cases = []
    for n, q in enumerate(questions, 1):
        results = search_chunks(q["question"], model, index, chunks, top_k=5)
        answer = generate_answer(q["question"], results)
        case = {"question": q["question"], "clean": answer, "planted": {}}
        for error_type in ERROR_TYPES:
            planted = ask_json(
                PLANT_PROMPT,
                f"Requested type: {error_type}\n\nCorrect answer:\n{answer}\n\nSource passages:\n{passages_text(results)}",
            )
            if not planted.get("skip") and planted.get("answer"):
                case["planted"][error_type] = {"answer": planted["answer"], "false_claim": planted.get("false_claim", "")}
        cases.append(case)
        print(f"  [{n:2}/{len(questions)}] planted: {', '.join(case['planted']) or 'none'}")
    return cases


def main():
    with open(QUESTIONS_FILE, encoding="utf-8") as f:
        # Bare spørsmål med et ekte svar på engelsk; det er dem faktasjekken skal håndtere
        questions = [q for q in csv.DictReader(f) if q["expected_page"] != "none" and q["type"] != "norsk"]

    model = load_embedding_model()
    chunks = []
    for source in sorted({q["source"] for q in questions}):
        pages, _ = extract_pages((EVAL_DIR / "papers" / source).read_bytes())
        chunks.extend(chunk_pages(pages, source=source))
    index = create_faiss_index(create_embeddings(chunks, model))

    if PLANTED_FILE.exists():
        cases = json.loads(PLANTED_FILE.read_text(encoding="utf-8"))
        print(f"Bruker lagrede plantede feil fra {PLANTED_FILE.relative_to(ROOT)}")
    else:
        print("Lager riktige svar og planter feil…")
        cases = build_planted_set(questions, model, index, chunks)
        PLANTED_FILE.write_text(json.dumps(cases, indent=2, ensure_ascii=False), encoding="utf-8")

    summary = {}
    for mode in PROMPTS:
        print(f"\nTester faktasjekk: {mode}")
        caught = {t: 0 for t in ERROR_TYPES}
        total = {t: 0 for t in ERROR_TYPES}
        false_alarms = 0
        clean_claims = 0

        for case in cases:
            results = search_chunks(case["question"], model, index, chunks, top_k=5)

            # Riktig svar: alt som fjernes her, er en falsk alarm
            clean = check_answer(case["question"], case["clean"], results, mode=mode)
            false_alarms += clean["removed"]
            clean_claims += len(clean["claims"])

            for error_type, planted in case["planted"].items():
                checked = check_answer(case["question"], planted["answer"], results, mode=mode)
                verdict = ask_json(
                    CAUGHT_PROMPT,
                    f"Planted false claim: {planted['false_claim']}\n\n"
                    f"Checker output:\n{json.dumps(checked['claims'], ensure_ascii=False)}",
                )
                total[error_type] += 1
                caught[error_type] += bool(verdict.get("caught"))

        summary[mode] = (caught, total, false_alarms, clean_claims)

    print("\n" + "=" * 70)
    print(f"{'Type feil':<12}" + "".join(f"{mode:>18}" for mode in PROMPTS))
    for error_type in ERROR_TYPES:
        cells = []
        for mode in PROMPTS:
            caught, total, *_ = summary[mode]
            cells.append(f"{caught[error_type]:>10}/{total[error_type]:<3} fanget")
        print(f"{error_type:<12}" + "".join(f"{c:>18}" for c in cells))
    cells = []
    for mode in PROMPTS:
        caught, total, *_ = summary[mode]
        cells.append(f"{sum(caught.values()):>10}/{sum(total.values()):<3} fanget")
    print(f"{'TOTALT':<12}" + "".join(f"{c:>18}" for c in cells))
    cells = []
    for mode in PROMPTS:
        _, _, false_alarms, clean_claims = summary[mode]
        cells.append(f"{false_alarms:>10}/{clean_claims:<3} fjernet")
    print(f"{'Falske alarmer':<12}" + "".join(f"{c:>18}" for c in cells))
    print("\nFalske alarmer = riktige påstander i riktige svar som faktasjekken likevel fjernet.")


if __name__ == "__main__":
    main()
