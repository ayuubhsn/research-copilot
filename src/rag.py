import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


MODEL_NAME = "all-MiniLM-L6-v2"


def load_embedding_model():
    """Laster modellen som gjør tekst om til embeddings."""
    return SentenceTransformer(MODEL_NAME)


def create_embeddings(chunks, model):
    """Lager én embedding-vektor per tekst-chunk."""
    texts = [chunk["text"] for chunk in chunks]

    if not texts:
        return np.array([], dtype="float32")

    embeddings = model.encode(
        texts,
        normalize_embeddings=True,
    )

    return np.array(embeddings, dtype="float32")


def create_faiss_index(embeddings):
    """Lager en FAISS-indeks for cosine similarity-søk."""
    if len(embeddings) == 0:
        return None

    embedding_dimension = embeddings.shape[1]

    # Normaliserte embeddings: inner product tilsvarer cosine similarity.
    index = faiss.IndexFlatIP(embedding_dimension)
    index.add(embeddings)

    return index


def search_chunks(query, model, index, chunks, top_k=3):
    """Finner de mest relevante PDF-chunkene for et spørsmål."""
    if index is None or not chunks:
        return []

    # Unngår at top_k er høyere enn antall chunks.
    top_k = min(top_k, len(chunks))

    query_embedding = model.encode(
        [query],
        normalize_embeddings=True,
    )

    query_embedding = np.array(
        query_embedding,
        dtype="float32",
    )

    scores, indices = index.search(query_embedding, top_k)

    results = []

    for score, chunk_index in zip(scores[0], indices[0]):
        if chunk_index == -1:
            continue

        results.append(
            {
                "text": chunks[chunk_index]["text"],
                "page_number": chunks[chunk_index]["page_number"],
                "score": float(score),
            }
        )

    return results
