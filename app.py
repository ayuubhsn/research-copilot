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


@st.cache_resource
def get_embedding_model():
    """Laster embedding-modellen én gang."""
    return load_embedding_model()


st.title("📚 ResearchCopilot")
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

            st.subheader("Answer")
            st.write(answer)

            st.subheader("Sources") 

            for result_number, result in enumerate(results, start=1):
                st.markdown(
                    f"### Result {result_number} — Page {result['page_number']}"
                )
                st.caption(
                    f"Similarity score: {result['score']:.3f}"
                )
                st.write(result["text"])

    st.divider()
    st.subheader("Extracted text")

    if not pages:
        st.warning(
            "No selectable text was found in this PDF. "
            "It may be a scanned document."
        )
    else:
        for page_data in pages:
            with st.expander(f"Page {page_data['page_number']}"):
                st.write(page_data["text"])
