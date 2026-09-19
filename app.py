import streamlit as st
from src.pdf_processor import extract_pages   

st.set_page_config(
    page_title="ResearchCopilot",
    page_icon="📚",
    layout="wide",
)

st.title("📚 ResearchCopilot")
st.caption("Upload an academic PDF and explore its content.")

uploaded_file = st.file_uploader(
    "Upload a PDF article",
    type=["pdf"],
)

if uploaded_file is not None:
    pdf_bytes = uploaded_file.read()
    pages, page_count = extract_pages(pdf_bytes)


    st.success(f"PDF uploaded: {uploaded_file.name}")
    st.metric("Pages", page_count)

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
