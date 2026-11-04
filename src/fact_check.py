"""
Faktasjekk: sjekker hver påstand i et svar mot teksten svaret bygger på.
 
Svaret deles opp i påstander. Hver påstand merkes som støttet eller ikke
støttet av kildene. Påstander uten støtte fjernes fra svaret. Står det
ingenting igjen, sier svaret ærlig at dokumentene ikke inneholder svaret.
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
 
STRICT_PROMPT = """You are a strict fact checker. You check an answer about a research paper against the
source passages it was based on. Assume the answer may contain subtle errors.
 
Step 1. Split the answer into its individual factual claims. A claim includes its details and its
links: numbers, names, dates, and words like "because", "so", "after", "turned down", "approved".
Skip sentences that only say something is not in the documents.
 
Step 2. For each claim, decide whether the passages support it. A claim is supported only if:
- every number, name and date in it matches the passages exactly, and
- the passages state the claim as a whole, about the same thing. Two true facts about different
  things must not be combined into one claim. If the answer says X happened because of Y, the
  passages must link X and Y.
Otherwise it is not supported. For each supported claim, quote the words in the passages that
support it. For each unsupported claim, say briefly what is wrong.
 
Step 3. Write revised_answer: the original answer with every unsupported claim removed.
Keep the wording and citations of the supported claims, and use the language of the question.
If no supported claim remains, revised_answer must say in one sentence, in the language of the
question, that the documents don't contain the answer.
 
Reply with JSON only:
{"claims": [{"claim": "...", "supported": true, "evidence": "..."}], "revised_answer": "..."}"""
 
PROMPTS = {"basic": BASIC_PROMPT, "strict": STRICT_PROMPT}
 
 
def check_answer(question, answer, results, mode="basic"):
    """Faktasjekker et svar mot treffene det bygger på.
 
    Returnerer det reviderte svaret og en liste over påstandene med vurdering.
    """
    if not results or not answer:
        return {"answer": answer, "claims": [], "removed": 0}
 
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
    claims = result.get("claims") or []
    removed = sum(1 for c in claims if not c.get("supported"))
 
    # Ingenting å fjerne: behold originalsvaret ordrett
    revised = answer if removed == 0 else (result.get("revised_answer") or answer)
    return {"answer": revised, "claims": claims, "removed": removed}
 