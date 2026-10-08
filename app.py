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
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
    #MainMenu, footer, header {visibility: hidden;}

    .stApp { background-color: #0a0a0f; }

    section[data-testid="stSidebar"] {
        background-color: #0d0d16;
        border-right: 1px solid #1e1e30;
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

    .hero-title {
        font-size: 2.4rem;
        font-weight: 700;
        background: linear-gradient(90deg, #4A90D9, #8ab4f8);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0;
    }

    .hero-sub {
        color: #8a8a9e;
        font-size: 1rem;
        margin-top: 4px;
        margin-bottom: 1.5rem;
    }

    .doc-pill {
        display: inline-block;
        background: #12121f;
        border: 1px solid #1e1e30;
        border-radius: 999px;
        padding: 4px 14px;
        margin: 3px 4px 3px 0;
        color: #bbb;
        font-size: 13px;
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

    .streamlit-expanderHeader {
        background-color: #12121f;
        border-radius: 8px;
    }

    .stButton > button {
        background: linear-gradient(135deg, #1a3a5c, #123);
        color: #e0e0e0;
        border: 1px solid #2a4a6c;
        border-radius: 10px;
        padding: 0.5rem 1.2rem;
    }

    .stButton > button:hover {
        border-color: #4A90D9;
        color: #ffffff;
    }
</style>
""", unsafe_allow_html=True)


def short_name(filename, max_length=35):
    if len(filename) <= max_length:
        return filename
    return filename[:max_length - 3] + "..."


@st.cache_resource
def get_embedding_model():
    return load_embedding_model()


# session state
if "index" not in st.session_state:
    st.session_state.index = None
    st.session_state.chunks = []
    st.session_state.file_names = []
    st.session_state.page_counts = {}

if "history" not in st.session_state:
    st.session_state.history = []


# sidebar
with st.sidebar:
    st.markdown("### 📚 ResearchCopilot")
    st.caption("Your AI research assistant")
    st.divider()

    uploaded_files = st.file_uploader(
        "Upload PDF articles",
        type=["pdf"],
        accept_multiple_files=True,
    )

    top_k = st.slider("Sources per answer", min_value=1, max_value=10, value=5)

    if st.button("Clear conversation", use_container_width=True):
        st.session_state.history = []
        st.rerun()

    st.divider()
    st.caption("Built with Streamlit, FAISS and Sentence Transformers")


# header
st.markdown('<p class="hero-title">ResearchCopilot</p>', unsafe_allow_html=True)
st.markdown(
    '<p class="hero-sub">Upload academic PDFs, then ask questions — '
    "get answers grounded in your sources.</p>",
    unsafe_allow_html=True,
)


# indexing
if uploaded_files:
    current_names = sorted([f.name for f in uploaded_files])

    if current_names != st.session_state.file_names:
        with st.status("Indexing your documents...", expanded=True) as status:
            all_chunks = []
            page_counts = {}
            model = get_embedding_model()

            for f in uploaded_files:
                st.write(f"Processing {f.name}...")
                pdf_bytes = f.read()
                pages, page_count = extract_pages(pdf_bytes)
                chunks = chunk_pages(pages, source=f.name)
                all_chunks.extend(chunks)
                page_counts[f.name] = page_count

            st.write("Creating embeddings...")
            embeddings = create_embeddings(all_chunks, model)

            st.write("Building search index...")
            index = create_faiss_index(embeddings)

            st.session_state.index = index
            st.session_state.chunks = all_chunks
            st.session_state.file_names = current_names
            st.session_state.page_counts = page_counts

            status.update(label="Indexing complete", state="complete", expanded=False)

    # metrics
    total_pages = sum(st.session_state.page_counts.values())
    c1, c2, c3 = st.columns(3)
    c1.metric("Documents", len(st.session_state.file_names))
    c2.metric("Pages", total_pages)
    c3.metric("Chunks", len(st.session_state.chunks))

    with st.expander("Indexed documents"):
        st.markdown(
            "".join(
                f'<span class="doc-pill">{short_name(n)}</span>'
                for n in st.session_state.file_names
            ),
            unsafe_allow_html=True,
        )

    st.divider()

    # chat input
    question = st.chat_input("Ask a question about your papers...")

    if question:
        with st.spinner("Searching and generating answer..."):
            model = get_embedding_model()
            results = search_chunks(
                query=question,
                model=model,
                index=st.session_state.index,
                chunks=st.session_state.chunks,
                top_k=top_k,
            )
            answer = generate_answer(question=question, results=results)

        st.session_state.history.append({
            "question": question,
            "answer": answer,
            "sources": results,
        })

    # conversation history
    for turn in st.session_state.history:
        with st.chat_message("user"):
            st.write(turn["question"])

        with st.chat_message("assistant"):
            st.markdown(
                f'<div class="answer-box">{turn["answer"]}</div>',
                unsafe_allow_html=True,
            )

            with st.expander(f"Sources ({len(turn['sources'])})"):
                for r in turn["sources"]:
                    st.markdown(f"""
                    <div class="source-card">
                        <span class="page-badge">{short_name(r['source'])} · Page {r['page_number']}</span>
                        <span class="score"> · {r['score']:.3f}</span>
                        <div class="text">{r['text'][:400]}...</div>
                    </div>
                    """, unsafe_allow_html=True)

else:
    st.info("Upload one or more PDF articles in the sidebar to get started.")
    st.markdown("""
**How it works**

1. Upload your research papers in the sidebar
2. Ask any question in natural language
3. Get an answer with citations to the exact pages
    """)