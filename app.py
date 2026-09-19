import streamlit as st
from src.pdf_processor import extract_pages   
from src.chunking import chunk_pages
from src.rag import create_embeddings, load_embedding_model

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


    st.success(f"PDF uploaded: {uploaded_file.name}")
    
    col1, col2,col3 = st.columns(3)
    col1.metric("Pages", page_count)
    col2.metric("Text chunks", len(chunks))
    col3.metric("Embeddings", len(embeddings))


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
