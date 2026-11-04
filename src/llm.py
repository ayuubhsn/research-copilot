from openai import OpenAI
from dotenv import load_dotenv
import os
 
from src.rag import unique_contexts
 
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
 
SYSTEM_PROMPT = """You are a research assistant that answers questions about academic PDFs.
 
Rules:
- Answer only using the provided context. Never add outside knowledge.
- After each claim, cite the source as (filename, page X), using the exact
  filename and page number shown in the context. A marker like [page 10]
  inside a passage means the text after it is on that page.
- If the context does not contain the answer, say so clearly in one sentence.
  Do not guess.
- Always answer in the same language as the user's question."""
 
 
def generate_answer(question, results):
    """Lager et svar basert på relevante PDF-chunks via OpenAI."""
    if not results:
        return "Ingen relevant tekst funnet."
 
    # Hvert treff sendes med nabobitene rundt, og overlappende treff bare én gang
    context = ""
    for r in unique_contexts(results):
        context += f"[{r['source']}, page {r['page_number']}]\n{r['context']}\n\n"
 
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\nQuestion: {question}"},
        ],
        temperature=0.2,
    )
 
    return response.choices[0].message.content
 