from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def generate_answer(question, results):
    """Lager et svar basert på relevante PDF-chunks via OpenAI."""
    if not results:
        return "Ingen relevant tekst funnet."

    context = ""
    for r in results:
        context += f"[Side {r['page_number']}]: {r['text']}\n\n"

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": """Du er en hjelpsom forskningsassistent.
Svar kun basert på konteksten. Ikke finn på informasjon.
Oppgi sidetall i svaret, for eksempel: (Side 3).
Svar på samme språk som spørsmålet."""},
            {"role": "user", "content": f"Kontekst:\n{context}\n\nSpørsmål: {question}"}
        ],
        temperature=0.2,
    )

    return response.choices[0].message.content