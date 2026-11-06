import os

# src.llm lager en OpenAI-klient ved import; testene kaller aldri OpenAI
os.environ.setdefault("OPENAI_API_KEY", "test-key")
