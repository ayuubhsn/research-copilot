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

    /* Upload-boksen */
    [data-testid="stFileUploader"] {
        background-color: #12121f;
        border: 1px dashed #2a2a3e;
        border-radius: 12px;
        padding: 1rem;
    }

    /* Metrics */
    [data-testid="stMetric"] {
        background-color: #12121f;
        border: 1px solid #1e1e30;
        border-radius: 12px;
        padding: 1rem;
    }

    /* Søkefelt */
    .stTextInput > div > div > input {
        background-color: #12121f;
        color: white;
        border: 1px solid #2a2a3e;
        border-radius: 10px;
        padding: 12px;
    }

    /* Resultat-kort */
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

    /* Answer-boksen */
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

    /* Expander */
    .streamlit-expanderHeader {
        background-color: #12121f;
        border-radius: 8px;
    }
</style>
""", unsafe_allow_html=True)

@st.cache_resource
def get_embedding_model():
    """Laster embedding-modellen én gang."""
    return load_embedding_model()


st.title("ResearchCopilot")
st.caption("Upload an academic PDF and explore its content.")

uploaded_file = st.file_uploader(
    "Upload a PDF article",
    type=["pdf"],
)

if uploaded_file is not None:
    pdf_bytes = uploaded_file.read()

    pages, page_count = extract_pages(pdf_bytes)
    chunks = chunk_pages(pages)

    model = get_embedding_model()
    embeddings = create_embeddings(chunks, model)
    index = create_faiss_index(embeddings)

    st.success(f"PDF uploaded: {uploaded_file.name}")

    col1, col2, col3 = st.columns(3)
    col1.metric("Pages", page_count)
    col2.metric("Text chunks", len(chunks))
    col3.metric("Embeddings", len(embeddings))

    st.divider()
    st.subheader("Search the PDF")

    query = st.text_input(
        "Ask a question about the PDF",
        placeholder="Example: What are the main findings?",
    )

    if query:
        results = search_chunks(
            query=query,
            model=model,
            index=index,
            chunks=chunks,
            top_k=5,
        )

        if not results:
            st.warning("No searchable text was found.")
        else:
            with st.spinner("Analyzing the PDF with OpenAI..."):
                answer = generate_answer(
                    question=query,
                    results=results,
                )

            st.markdown(f'<div class="answer-box">{answer}</div>', unsafe_allow_html=True)

            st.subheader("Sources")
            for i, r in enumerate(results, start=1):
                st.markdown(f"""
                <div class="source-card">
                    <span class="page-badge">📄 Page {r['page_number']}</span>
                    <span class="score"> · Similarity: {r['score']:.3f}</span>
                    <div class="text">{r['text']}</div>
                </div>
                """, unsafe_allow_html=True)

    st.divider()
    with st.expander("View extracted text"):
        if not pages:
            st.warning("No selectable text was found in this PDF.")
        else:
            for page_data in pages:
                st.markdown(f"**Page {page_data['page_number']}**")
                st.write(page_data["text"])