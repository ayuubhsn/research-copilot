"""
Faktasjekk: sjekker hver påstand i et svar mot teksten svaret bygger på.

Svaret deles opp i påstander, og hver påstand får en status:
- støttet: kildene sier det
- delvis støttet: hovedpoenget står i kildene, men en detalj gjør det ikke
- ikke støttet: kildene sier det ikke, eller sier noe annet
Påstander uten støtte fjernes fra svaret, men vises med begrunnelse. Står
det ingenting igjen, sier svaret ærlig at dokumentene ikke inneholder svaret.
"""

import json

from src.llm import client
from src.rag import unique_contexts

MODEL = "gpt-4o-mini"

BASIC_PROMPT = """You check an answer about a research paper against the source passages it was based on.

Step 1. Split the answer into its individual factual claims. Skip sentences that only say
something is not in the documents.

Step 2. For each claim, decide whether the passages support it:
- supported: the passages state it, or it follows directly from what they state
- not supported: the passages don't state it, or they say something different
For each supported claim, quote the few words in the passages that support it.

Step 3. Write revised_answer: the original answer with every unsupported claim removed.
Keep the wording and citations of the supported claims, and use the language of the question.
If no supported claim remains, revised_answer must say in one sentence, in the language of the
question, that the documents don't contain the answer.

Reply with JSON only:
{"claims": [{"claim": "...", "supported": true, "evidence": "..."}], "revised_answer": "..."}"""

THREE_LEVEL_PROMPT = """You check an answer about a research paper against the source passages it was based on.

Step 1. Split the answer into its individual factual claims. Skip sentences that only say
something is not in the documents.

Step 2. Give each claim one status:
- supported: the passages state it, or it follows directly from what they state
- partial: the main point is in the passages, but the claim adds a detail they don't mention,
  or states it more strongly or more generally than they do
- unsupported: the passages don't state it, or they contradict any part of it (a different
  number, name or date, or two facts about different things joined into one claim)
For supported and partial claims, quote the few words in the passages that support them.
For partial and unsupported claims, say in one short sentence what the passages don't back up.

Step 3. Write revised_answer: the original answer with every unsupported claim removed.
Keep supported and partial claims with their wording and citations, and use the language of
the question. If nothing remains, revised_answer must say in one sentence, in the language of
the question, that the documents don't contain the answer.

Reply with JSON only:
{"claims": [{"claim": "...", "status": "supported", "evidence": "...", "reason": "..."}],
 "revised_answer": "..."}"""

# "binary" er den gamle varianten med bare støttet / ikke støttet. Den er beholdt
# så evalueringen kan sammenligne de to på de samme plantede feilene.
PROMPTS = {"three-level": THREE_LEVEL_PROMPT, "binary": BASIC_PROMPT}
STATUSES = ("supported", "partial", "unsupported")


def normalize_claim(claim):
    """Gir hver påstand et status-felt, også fra den gamle ja/nei-varianten."""
    status = claim.get("status")
    if status not in STATUSES:
        status = "supported" if claim.get("supported") else "unsupported"
    return {
        "claim": claim.get("claim", ""),
        "status": status,
        "supported": status == "supported",
        "evidence": claim.get("evidence") or "",
        "reason": claim.get("reason") or "",
    }


def check_answer(question, answer, results, mode="three-level"):
    """Faktasjekker et svar mot treffene det bygger på.

    Returnerer det reviderte svaret og påstandene med status (støttet, delvis
    støttet, ikke støttet). Bare påstander uten støtte fjernes; de vises
    likevel i listen, med begrunnelse, så brukeren ser hva som ble tatt bort.
    """
    if not results or not answer:
        return {"answer": answer, "claims": [], "removed": 0, "partial": 0}

    passages = "\n\n".join(
        f"[{r['source']}, page {r['page_number']}]\n{r['context']}" for r in unique_contexts(results)
    )
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": PROMPTS[mode]},
            {
                "role": "user",
                "content": f"Question: {question}\n\nAnswer to check:\n{answer}\n\nSource passages:\n{passages}",
            },
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    result = json.loads(response.choices[0].message.content)
    claims = [normalize_claim(c) for c in result.get("claims") or []]
    removed = sum(1 for c in claims if c["status"] == "unsupported")
    partial = sum(1 for c in claims if c["status"] == "partial")

    # Ingenting å fjerne: behold originalsvaret ordrett
    revised = answer if removed == 0 else (result.get("revised_answer") or answer)
    return {"answer": revised, "claims": claims, "removed": removed, "partial": partial}
