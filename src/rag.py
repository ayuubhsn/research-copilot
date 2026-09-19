from sentence_transformers import SentenceTransformer


MODEL_NAME = "all-MiniLM-L6-v2"


def load_embedding_model():
    """Laster modellen som gjør tekst om til embeddings."""
    return SentenceTransformer(MODEL_NAME)


def create_embeddings(chunks, model):
    """Lager én embedding-vektor per tekst-chunk."""
    texts = [chunk["text"] for chunk in chunks]

    if not texts:
        return []

    return model.encode(
        texts,
        normalize_embeddings=True,
    )
