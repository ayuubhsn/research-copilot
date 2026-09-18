import fitz  # PyMuPDF
import streamlit as st


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
    document = fitz.open(stream=pdf_bytes, filetype="pdf")

    st.success(f"PDF uploaded: {uploaded_file.name}")
    st.metric("Pages", len(document))

    pages = []

    for page_number, page in enumerate(document, start=1):
        page_text = page.get_text().strip()

        if page_text:
            pages.append(
                {
                    "page_number": page_number,
                    "text": page_text,
                }
            )

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
