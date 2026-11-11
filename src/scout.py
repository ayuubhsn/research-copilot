"""
Scout: en søkeagent som bruker søket som verktøy.

Vanlig RAG søker én gang og svarer. Scout lar GPT bestemme selv:
den planlegger, søker, vurderer treffene og søker på nytt med andre
ord hvis treffene er svake. Hvert steg lagres i en logg (trace), så
man kan se nøyaktig hva den gjorde.
"""

import json

from src.fact_check import check_answer
from src.llm import client
from src.rag import search_chunks, unique_contexts

MODEL = "gpt-4o-mini"
MAX_SEARCHES = 5          # aldri mer enn 5 søk per spørsmål
MAX_WEAK_IN_ROW = 3       # gir opp etter 3 svake søk på rad
WEAK_SCORE = 0.45         # beste treff under dette regnes som svakt (justeres med testsettet)

SYSTEM_PROMPT = f"""You are Scout, a research assistant that answers questions about academic PDFs.

You have one tool, search, which returns the passages most similar in meaning to a query,
with file name, page number and a similarity score from 0 to 1. Each passage includes the text
just before and after it. A marker like [page 10] means the text after it is on that page.

How to work:
- Before your first search, state your plan in one short sentence.
- If the question has several parts, search for each part.
- If the best score is low or the passages don't answer the question, rephrase the search.
  Use the words the paper itself would likely use (for example "This paper asks" instead of
  "research question").
- Before answering, check that every part of the question is answered by a passage you found.
  If a part is missing, search for that part.
- You can search at most {MAX_SEARCHES} times.

How to answer:
- Answer only from the passages you found. Never add outside knowledge.
- After each claim, cite the source as (filename, page X).
- If the passages don't contain the answer, say so clearly in one sentence. Do not guess.
- Answer in the same language as the question."""

SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "search",
        "description": "Search the uploaded documents for passages relevant to a query.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for, in the paper's own words."}
            },
            "required": ["query"],
        },
    },
}


def format_results(results, weak):
    """Gjør søketreffene om til tekst GPT kan lese."""
    if not results:
        return "No passages found."
    lines = []
    # Hvert treff sendes med nabobitene rundt, og overlappende treff bare én gang
    for r in unique_contexts(results):
        exact = ", exact phrase match" if r.get("phrase_match") else ""
        lines.append(f"[{r['source']}, page {r['page_number']}, score {r['score']:.2f}{exact}]\n{r['context']}")
    note = "\n\nNote: the best match is weak. Consider rephrasing." if weak else ""
    return "\n\n".join(lines) + note


def run_scout(question, model, index, chunks, top_k=5, check=True):
    """Kjører Scout på ett spørsmål. Returnerer svaret og loggen over alle steg.

    Med check=True faktasjekkes svaret mot alle treffene Scout så, og påstander
    uten støtte fjernes før svaret returneres.
    """
    position_of = {c["text"]: i for i, c in enumerate(chunks)}
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    trace = []
    searches = 0
    weak_in_row = 0
    seen = {}  # alle treffene Scout har sett, til faktasjekken

    while True:
        out_of_searches = searches >= MAX_SEARCHES or weak_in_row >= MAX_WEAK_IN_ROW

        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=[SEARCH_TOOL],
            # Når grensen er nådd, får GPT ikke lov til å søke mer og må svare
            tool_choice="none" if out_of_searches else "auto",
            temperature=0.2,
        )
        message = response.choices[0].message

        # Tekst sammen med et søk er Scouts tanke eller plan
        if message.content and message.tool_calls:
            trace.append({"type": "think", "text": message.content})

        if not message.tool_calls:
            stopped = weak_in_row >= MAX_WEAK_IN_ROW
            trace.append({"type": "stop" if stopped else "answer", "text": message.content})
            passages = list(seen.values())
            answer = message.content

            if check and not stopped:
                checked = check_answer(question, answer, passages)
                trace.append(
                    {"type": "check", "claims": checked["claims"], "removed": checked["removed"], "partial": checked["partial"]}
                )
                answer = checked["answer"]

            return {
                "question": question,
                "answer": answer,
                "searches": searches,
                "gave_up": stopped,
                "passages": passages,
                "trace": trace,
            }

        messages.append(
            {
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.function.name, "arguments": call.function.arguments},
                    }
                    for call in message.tool_calls
                ],
            }
        )

        for call in message.tool_calls:
            # GPT kan be om flere søk samtidig; grensen gjelder hvert enkelt søk
            if searches >= MAX_SEARCHES or weak_in_row >= MAX_WEAK_IN_ROW:
                messages.append({"role": "tool", "tool_call_id": call.id,
                                 "content": "Search limit reached. Answer now, or say the answer is not in the documents."})
                continue

            query = json.loads(call.function.arguments).get("query", question)
            results = search_chunks(query, model, index, chunks, top_k=top_k)
            best = max((r["score"] for r in results), default=0.0)
            phrase_found = any(r.get("phrase_match") for r in results)
            # Svakt = lav likhet i betydning OG ingen eksakt treff på frasen
            weak = best < WEAK_SCORE and not phrase_found

            searches += 1
            weak_in_row = weak_in_row + 1 if weak else 0
            for r in results:
                seen.setdefault(r["chunk"], r)

            trace.append(
                {
                    "type": "search",
                    "query": query,
                    "best": round(best, 3),
                    "weak": weak,
                    "phrase_found": phrase_found,
                    "hits": [
                        {
                            "chunk": position_of.get(r["text"]),
                            "page": r["page_number"],
                            "source": r["source"],
                            "score": round(r["score"], 3),
                        }
                        for r in results
                    ],
                }
            )
            messages.append({"role": "tool", "tool_call_id": call.id, "content": format_results(results, weak)})
