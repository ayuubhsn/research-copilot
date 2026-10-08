import streamlit as st

from src.chunking import chunk_pages
from src.llm import generate_answer
from src.pdf_processor import extract_pages
from src.rag import (
    create_embeddings,
    create_faiss_index,
    load_embedding_model,
    search_chunks,
)

st.set_page_config(
    page_title="ResearchCopilot",
    page_icon="📚",
    layout="wide",
)

st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}

    .stApp {
        background-color: #0a0a0f;
    }

    [data-testid="stFileUploader"] {
        background-color: #12121f;
        border: 1px dashed #2a2a3e;
        border-radius: 12px;
        padding: 1rem;
    }

    [data-testid="stMetric"] {
        background-color: #12121f;
        border: 1px solid #1e1e30;
        border-radius: 12px;
        padding: 1rem;
    }

    .stTextInput > div > div > input {
        background-color: #12121f;
        color: white;
        border: 1px solid #2a2a3e;
        border-radius: 10px;
        padding: 12px;
    }

    .source-card {
        background: #12121f;
        border: 1px solid #1e1e30;
        border-radius: 12px;
        padding: 1.2rem;
        margin-bottom: 0.8rem;
    }

    .source-card .page-badge {
        color: #4A90D9;
        font-size: 13px;
        font-weight: 600;
    }

    .source-card .score {
        color: #666;
        font-size: 12px;
    }

    .source-card .text {
        color: #bbb;
        font-size: 14px;
        margin-top: 8px;
        line-height: 1.6;
    }

    .answer-box {
        background: linear-gradient(135deg, #0f1a2e, #12121f);
        border: 1px solid #1a3a5c;
        border-radius: 12px;
        padding: 1.5rem;
        color: #e0e0e0;
        font-size: 15px;
        line-height: 1.7;
        margin-bottom: 1rem;
    }

    .streamlit-expanderHeader {
        background-color: #12121f;
        border-radius: 8px;
    }
</style>
""", unsafe_allow_html=True)


@st.cache_resource
def get_embedding_model():
    return load_embedding_model()


st.title("📚 ResearchCopilot")
st.caption("Upload academic PDFs and search across them.")

uploaded_files = st.file_uploader(
    "Upload PDF articles",
    type=["pdf"],
    accept_multiple_files=True,
)

if uploaded_files:
    # samle chunks fra alle PDFer
    all_chunks = []
    total_pages = 0

    for uploaded_file in uploaded_files:
        pdf_bytes = uploaded_file.read()
        pages, page_count = extract_pages(pdf_bytes)
        chunks = chunk_pages(pages, source=uploaded_file.name)
        all_chunks.extend(chunks)
        total_pages += page_count

    model = get_embedding_model()
    embeddings = create_embeddings(all_chunks, model)
    index = create_faiss_index(embeddings)

    st.success(f"{len(uploaded_files)} PDF(s) uploaded")

    col1, col2, col3 = st.columns(3)
    col1.metric("Documents", len(uploaded_files))
    col2.metric("Total pages", total_pages)
    col3.metric("Text chunks", len(all_chunks))

    st.divider()
    st.subheader("Search across documents")

    query = st.text_input(
        "Ask a question",
        placeholder="Example: What are the main findings?",
    )

    if query:
        results = search_chunks(
            query=query,
            model=model,
            index=index,
            chunks=all_chunks,
            top_k=5,
        )

        if not results:
            st.warning("No relevant sources found.")
        else:
            with st.spinner("Analyzing..."):
                answer = generate_answer(
                    question=query,
                    results=results,
                )

            st.subheader("Answer")
            st.markdown(f'<div class="answer-box">{answer}</div>', unsafe_allow_html=True)

            st.subheader("Sources")
            for i, r in enumerate(results, start=1):
                st.markdown(f"""
                <div class="source-card">
                    <span class="page-badge">📄 {r['source']} — Page {r['page_number']}</span>
                    <span class="score"> · Similarity: {r['score']:.3f}</span>
                    <div class="text">{r['text']}</div>
                </div>
                """, unsafe_allow_html=True)

    st.divider()
    with st.expander("View extracted text"):
        for uploaded_file in uploaded_files:
            st.markdown(f"### {uploaded_file.name}")
            pdf_bytes = uploaded_file.read()
            if pdf_bytes:
                pages, _ = extract_pages(pdf_bytes)
                for page_data in pages:
                    st.markdown(f"**Page {page_data['page_number']}**")
                    st.write(page_data["text"])