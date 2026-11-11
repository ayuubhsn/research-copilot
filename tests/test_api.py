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
import api.metadata as metadata
from src.fact_check import normalize_claim

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
    monkeypatch.setattr(metadata, "fetch_json", lambda url, accept="application/json", timeout=6: None)  # ingen nettverk i testene

    def fake_answer(question, results):
        r = results[0]
        return f"The retriever merges keyword and embedding scores ({r['source']}, page {r['page_number']})."

    def fake_check(question, answer, results, mode="three-level"):
        evidence = "merges BM25 keyword scores with dense embedding scores"
        claims = [
            normalize_claim({"claim": answer, "status": "supported", "evidence": evidence}),
            normalize_claim({"claim": "It doubled accuracy.", "status": "unsupported", "reason": "No number is given."}),
        ]
        return {"answer": answer, "claims": claims, "removed": 1, "partial": 0}

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


def test_ask_reports_removed_claims_with_reasons(client):
    doc = upload(client).json()
    result = client.post(f"/documents/{doc['id']}/ask", json={"question": "How does the retriever work?"}).json()
    removed = [c for c in result["claims"] if c["status"] == "unsupported"]
    assert result["removed"] == 1 and removed[0]["reason"]


def test_normalize_claim_handles_old_and_new_format():
    assert normalize_claim({"claim": "a", "supported": True})["status"] == "supported"
    assert normalize_claim({"claim": "a", "supported": False})["status"] == "unsupported"
    assert normalize_claim({"claim": "a", "status": "partial"})["supported"] is False


def test_search_finds_passages_across_documents(client):
    first = upload(client).json()
    other = pymupdf.open()
    other.new_page().insert_textbox(pymupdf.Rect(72, 72, 520, 760), "Photosynthesis turns light into chemical energy in plants.")
    second = upload(client, other.tobytes(), name="biology.pdf").json()

    hits = client.get("/search", params={"q": "hybrid retriever reciprocal rank fusion"}).json()
    assert hits and hits[0]["docId"] == first["id"]
    assert hits[0]["rects"], "the hit should be located on its page"

    hits = client.get("/search", params={"q": "light into chemical energy", "docs": second["id"]}).json()
    assert {h["docId"] for h in hits} == {second["id"]}


def test_notebook_save_edit_delete(client):
    doc = upload(client).json()
    quote = "merges BM25 keyword scores with dense embedding scores"
    saved = client.post("/notebook", json={"docId": doc["id"], "page": 2, "text": quote}).json()
    assert saved["rects"], "a quote marked on the page should be found there"

    edited = client.patch(f"/notebook/{saved['id']}", json={"note": "Use in chapter 2", "tags": ["Method"]}).json()
    assert edited["note"] == "Use in chapter 2" and edited["tags"] == ["Method"]
    assert len(client.get("/notebook").json()) == 1

    assert client.delete(f"/notebook/{saved['id']}").status_code == 204
    assert client.get("/notebook").json() == []


def test_notes_are_removed_with_their_document(client):
    doc = upload(client).json()
    client.post("/notebook", json={"docId": doc["id"], "page": 1, "text": "Retrieval augmented generation"})
    client.delete(f"/documents/{doc['id']}")
    assert client.get("/notebook").json() == []


def test_citation_can_be_corrected(client):
    doc = upload(client).json()
    assert doc["citation"]["source"] == "pdf"  # ingen DOI i test-PDF-en
    citation = {"title": "A paper", "authors": [{"family": "Liu", "given": "Nelson F."}], "year": 2023, "type": "preprint"}
    updated = client.put(f"/documents/{doc['id']}/citation", json=citation).json()
    assert updated["citation"]["authors"][0]["family"] == "Liu"
    assert updated["citation"]["source"] == "user"


def test_doi_is_found_and_read_from_csl():
    assert metadata.find_doi("see https://doi.org/10.1038/nature14539.") == "10.1038/nature14539"
    assert metadata.find_doi("arXiv:2307.03172v3 [cs.CL]") == "10.48550/arXiv.2307.03172"
    csl = {
        "title": "Deep learning",
        "author": [{"family": "LeCun", "given": "Yann"}],
        "issued": {"date-parts": [[2015, 5, 27]]},
        "container-title": "Nature",
        "volume": "521",
        "page": "436-444",
        "type": "journal-article",
    }
    citation = metadata.from_csl(csl, "10.1038/nature14539")
    assert citation["year"] == 2015 and citation["container"] == "Nature" and citation["type"] == "article"


def test_title_and_year_are_guessed_without_a_doi():
    pdf = pymupdf.open()
    page = pdf.new_page()
    # Et loddrett arXiv-stempel i margen, slik arXiv setter det, skal ikke bli tittelen
    page.insert_text((30, 600), "arXiv:2307.03172v3 [cs.CL] 20 Nov 2023", fontsize=20, rotate=90)
    page.insert_text((72, 100), "Lost in the Middle", fontsize=18)
    page.insert_textbox(pymupdf.Rect(72, 140, 520, 400), "Body text about long contexts, citing work from 2019. " * 5, fontsize=10)
    citation = metadata.guess_from_pdf(pdf.tobytes(), "paper.pdf")
    assert citation["title"] == "Lost in the Middle"
    assert citation["year"] == 2023 and citation["type"] == "preprint"


def test_falls_back_to_file_name_when_no_title_stands_out():
    pdf = pymupdf.open()
    pdf.new_page().insert_textbox(pymupdf.Rect(72, 72, 520, 760), "Plain text of one size only. " * 30, fontsize=11)
    assert metadata.guess_from_pdf(pdf.tobytes(), "notes.pdf")["title"] == "notes"


def test_saved_selection_is_extended_to_whole_words(client):
    doc = upload(client).json()
    # Markeringen startet og sluttet midt i et ord
    saved = client.post("/notebook", json={"docId": doc["id"], "page": 2, "text": "ur experiments use a hybrid retri"}).json()
    assert saved["text"].startswith("Our experiments use a hybrid retriever")


def test_download_stamps_do_not_set_the_year():
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 60), "For the exclusive use of A. Hassan, 2026.", fontsize=12)
    page.insert_text((72, 110), "Managing Innovation at Nypro", fontsize=18)
    page.insert_textbox(pymupdf.Rect(72, 140, 520, 400), "Case text about molding. " * 8, fontsize=10)
    page.insert_text((72, 700), "Copyright 1996 President and Fellows of Harvard College.", fontsize=8)
    assert metadata.guess_from_pdf(pdf.tobytes(), "case.pdf")["year"] == 1996


MINTZBERG_CSL = {
    "title": "Of strategies, deliberate and emergent",
    "author": [{"family": "Mintzberg", "given": "Henry"}, {"family": "Waters", "given": "James A."}],
    "issued": {"date-parts": [[1985]]},
    "container-title": "Strategic Management Journal",
    "volume": "6",
    "issue": "3",
    "page": "257-272",
    "type": "journal-article",
}


def fake_network(url, accept="application/json", timeout=6):
    if "api.crossref.org" in url:
        return {"message": {"items": [
            {"DOI": "10.1000/other", "title": ["Strategies for something else"], "issued": {"date-parts": [[1985]]}},
            {"DOI": "10.1002/smj.4250060306", "title": ["Of Strategies, Deliberate and Emergent"], "issued": {"date-parts": [[1985]]}},
        ]}}
    if url.endswith("10.1002/smj.4250060306"):
        return MINTZBERG_CSL
    return None


def test_title_is_looked_up_when_the_pdf_has_no_doi(monkeypatch):
    monkeypatch.setattr(metadata, "fetch_json", fake_network)
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 100), "Of Strategies, Deliberate and Emergent", fontsize=18)
    page.insert_textbox(pymupdf.Rect(72, 140, 520, 400), "Strategy text from 1985. " * 8, fontsize=10)
    pages = [{"page_number": 1, "text": page.get_text()}]
    citation = metadata.lookup(pdf.tobytes(), pages, "mintzberg.pdf")
    assert citation["doi"] == "10.1002/smj.4250060306"
    assert citation["authors"][0]["family"] == "Mintzberg" and citation["container"] == "Strategic Management Journal"


def test_title_lookup_rejects_a_different_paper(monkeypatch):
    monkeypatch.setattr(metadata, "fetch_json", fake_network)
    assert metadata.search_title("Strategies for planning in small firms", 1985) is None


def test_lookup_endpoint_fills_details_from_a_doi(client, monkeypatch):
    doc = upload(client).json()
    monkeypatch.setattr(metadata, "fetch_json", fake_network)
    found = client.post(f"/documents/{doc['id']}/citation/lookup", json={"doi": "https://doi.org/10.1002/smj.4250060306"}).json()
    assert found["year"] == 1985 and found["source"] == "doi"
    assert client.post(f"/documents/{doc['id']}/citation/lookup", json={"doi": "10.1/none"}).status_code == 404
