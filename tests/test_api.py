"""
Tester API-et uten nettverk: embedding-modellen og OpenAI-kallene byttes
ut med enkle stand-ins, så testene sjekker flyten og formatet på svarene.

Kjør fra prosjektmappen:
    python -m pytest tests
"""

import hashlib

import numpy as np
import pymupdf
import pytest
from fastapi.testclient import TestClient

import api.main as main

PAGES = [
    "Retrieval augmented generation combines search with a language model. "
    "The retriever finds passages and the generator writes an answer from them.",
    "Our experiments use a hybrid retriever. It merges BM25 keyword scores with dense "
    "embedding scores using reciprocal rank fusion, which improved accuracy on every test set.",
    "Language models perform worst when the relevant passage sits in the middle of a long "
    "context. This mirrors the serial-position effect described in psychology.",
] * 3
# Hver side får et eget nummer, så ingen sider er helt like
PAGES = [f"Section {i + 1}. {text}" for i, text in enumerate(PAGES)]


class FakeModel:
    """Ord hashes til en vektor, så like tekster får like vektorer. Ingen nedlasting."""

    def encode(self, texts, normalize_embeddings=True):
        vectors = np.zeros((len(texts), 64), dtype="float32")
        for row, text in enumerate(texts):
            for word in text.lower().split():
                vectors[row, int(hashlib.md5(word.encode()).hexdigest(), 16) % 64] += 1
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)


def make_pdf():
    pdf = pymupdf.open()
    for text in PAGES:
        page = pdf.new_page()
        page.insert_textbox(pymupdf.Rect(72, 72, 520, 760), text, fontsize=11)
    return pdf.tobytes()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "load_embedding_model", FakeModel)

    def fake_answer(question, results):
        r = results[0]
        return f"The retriever merges keyword and embedding scores ({r['source']}, page {r['page_number']})."

    def fake_check(question, answer, results, mode="basic"):
        evidence = "merges BM25 keyword scores with dense embedding scores"
        return {"answer": answer, "claims": [{"claim": answer, "supported": True, "evidence": evidence}], "removed": 0}

    def fake_scout(question, model, index, chunks, top_k=5, check=True):
        from src.rag import search_chunks

        results = search_chunks("hybrid retriever", model, index, chunks, top_k=top_k)
        return {
            "question": question,
            "answer": fake_answer(question, results),
            "searches": 1,
            "gave_up": False,
            "passages": results,
            "trace": [
                {"type": "search", "query": "hybrid retriever", "best": 0.5, "weak": False, "phrase_found": True, "hits": []},
                {"type": "answer", "text": "..."},
                {"type": "check", "claims": [], "removed": 0},
            ],
        }

    monkeypatch.setattr(main, "generate_answer", fake_answer)
    monkeypatch.setattr(main, "check_answer", fake_check)
    monkeypatch.setattr(main, "run_scout", fake_scout)

    with TestClient(main.app) as test_client:
        yield test_client


def upload(client, data=None, name="paper.pdf"):
    return client.post("/documents", files={"file": (name, data or make_pdf(), "application/pdf")})


def test_upload_and_read(client):
    response = upload(client)
    assert response.status_code == 201
    doc = response.json()
    assert doc["pageCount"] == len(PAGES)
    assert doc["passages"] > 0

    assert client.get("/documents").json() == [doc]
    assert len(client.get(f"/documents/{doc['id']}/pages").json()) == len(PAGES)
    assert client.get(f"/documents/{doc['id']}/file").headers["content-type"] == "application/pdf"
    assert len(client.get(f"/documents/{doc['id']}/map").json()["points"]) == doc["passages"]


def test_same_file_is_stored_once(client):
    data = make_pdf()
    first = upload(client, data).json()
    second = upload(client, data, name="copy.pdf").json()
    assert first["id"] == second["id"]
    assert len(client.get("/documents").json()) == 1


def test_rejects_files_that_are_not_pdfs(client):
    response = upload(client, data=b"not a pdf", name="notes.txt")
    assert response.status_code == 400


def test_ask_fast_returns_sources_with_highlights(client):
    doc = upload(client).json()
    result = client.post(f"/documents/{doc['id']}/ask", json={"question": "How does the retriever work?"}).json()

    assert result["mode"] == "fast"
    assert result["sources"], "expected at least one source"
    assert all(s["rects"] for s in result["sources"]), "every source should be found on its page"
    rect = result["sources"][0]["rects"][0]
    assert 0 <= rect["x"] <= 1 and 0 <= rect["y"] <= 1

    claim = result["claims"][0]
    assert claim["page"] is not None and claim["rects"], "the supporting quote should be located"
    assert result["position"] is not None


def test_ask_scout(client):
    doc = upload(client).json()
    result = client.post(f"/documents/{doc['id']}/ask", json={"question": "What retriever?", "mode": "scout"}).json()
    assert result["mode"] == "scout"
    assert result["searches"] == 1
    assert result["trace"][0]["type"] == "search"


def test_unknown_document(client):
    assert client.post("/documents/nope/ask", json={"question": "Hi"}).status_code == 404


def test_documents_survive_a_restart(client, tmp_path):
    doc = upload(client).json()
    with TestClient(main.app) as restarted:
        assert [d["id"] for d in restarted.get("/documents").json()] == [doc["id"]]
