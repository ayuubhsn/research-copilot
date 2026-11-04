import re
 
import faiss
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
 
 
MODEL_NAME = "all-MiniLM-L6-v2"
RRF_K = 60  # standardverdi for Reciprocal Rank Fusion
CONTEXT_WINDOW = 2  # antall nabobiter før og etter hvert treff som sendes til GPT
 
 
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
 
 
def tokenize(text):
    """Deler tekst i ord for nøkkelordsøket, uten vanlige småord."""
    return [w for w in re.findall(r"\w+", text.lower()) if w not in ENGLISH_STOP_WORDS]
 
 
# Nøkkelordindeksen bygges én gang per sett med chunks og gjenbrukes
_keyword_indexes = {}
 
 
def get_keyword_index(chunks):
    """Henter (eller bygger) BM25-indeksen for disse chunkene."""
    key = (len(chunks), chunks[0]["text"][:200], chunks[-1]["text"][:200])
    if key not in _keyword_indexes:
        _keyword_indexes[key] = BM25Okapi([tokenize(c["text"]) for c in chunks])
    return _keyword_indexes[key]
 
 
def build_context(i, chunks, window=CONTEXT_WINDOW):
    """Setter sammen treffet med nabobitene rundt, fra samme dokument.
 
    Lister og forklaringer går ofte over flere biter etter hverandre. Med
    nabobitene ser GPT hele sammenhengen, ikke bare biten som traff søket.
    Returnerer teksten og hvilke biter den dekker.
    """
    source = chunks[i]["source"]
    start, end = i, i
    while start > 0 and i - start < window and chunks[start - 1]["source"] == source:
        start -= 1
    while end < len(chunks) - 1 and end - i < window and chunks[end + 1]["source"] == source:
        end += 1
 
    parts = []
    previous = None
    for j in range(start, end + 1):
        text = chunks[j]["text"]
        if previous is not None:
            # Bitene overlapper med én setning; den fjernes så den ikke gjentas
            last_sentence = previous["text"].rsplit(". ", 1)[-1]
            if last_sentence and text.startswith(last_sentence):
                text = text[len(last_sentence):].lstrip()
            # Markerer sideskift, så GPT kan sitere riktig side
            if chunks[j]["page_number"] != previous["page_number"]:
                text = f"[page {chunks[j]['page_number']}] {text}"
        parts.append(text)
        previous = chunks[j]
 
    return " ".join(parts), list(range(start, end + 1))
 
 
def search_chunks(query, model, index, chunks, top_k=5):
    """Hybrid-søk: kombinerer betydning (embeddings) og eksakte ord (BM25).
 
    Embedding-søket er godt på mening, men bommer på eksakte fraser som
    "This paper asks". BM25 er motsatt. Begge rangerer alle chunkene, og
    Reciprocal Rank Fusion slår sammen rangeringene: en chunk som ligger
    høyt i én av dem, eller middels i begge, havner høyt totalt.
    """
    if index is None or not chunks:
        return []
 
    top_k = min(top_k, len(chunks))
 
    # 1) Embedding-søk: cosine similarity for alle chunkene
    query_embedding = np.array(model.encode([query], normalize_embeddings=True), dtype="float32")
    dense_scores, dense_order = index.search(query_embedding, len(chunks))
    cosine = {int(i): float(s) for i, s in zip(dense_order[0], dense_scores[0]) if i != -1}
 
    # 2) Nøkkelordsøk: BM25-score for alle chunkene
    keyword_scores = get_keyword_index(chunks).get_scores(tokenize(query))
    keyword_order = [int(i) for i in np.argsort(-keyword_scores) if keyword_scores[i] > 0]
 
    # 3) Slår sammen rangeringene
    fused = {}
    for rank, i in enumerate(int(i) for i in dense_order[0] if i != -1):
        fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, i in enumerate(keyword_order):
        fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + rank + 1)
 
    phrase = query.lower().strip(" \"'.?")
    results = []
    for i in sorted(fused, key=fused.get, reverse=True)[:top_k]:
        context, context_chunks = build_context(i, chunks)
        results.append(
            {
                "chunk": i,
                "context": context,                # treffet med nabobiter, til GPT
                "context_chunks": context_chunks,
                "text": chunks[i]["text"],
                "page_number": chunks[i]["page_number"],
                "source": chunks[i]["source"],
                "score": cosine.get(i, 0.0),           # likhet i betydning (0–1), som før
                "keyword_score": round(float(keyword_scores[i]), 2),
                "phrase_match": len(phrase) > 3 and phrase in chunks[i]["text"].lower(),
            }
        )
 
    return results
 
 
def unique_contexts(results):
    """Hopper over treff som allerede er dekket av et tidligere treffs nabobiter.
 
    Treff som ligger tett i samme dokument ville ellers gitt GPT den samme
    teksten flere ganger.
    """
    covered = set()
    unique = []
    for r in results:
        if r["chunk"] in covered:
            continue
        covered.update(r["context_chunks"])
        unique.append(r)
    return unique
 