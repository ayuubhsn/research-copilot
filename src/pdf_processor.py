import fitz  # PyMuPDF


def extract_pages(pdf_bytes):
    """Leser en PDF og returnerer tekst fra hver side."""
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
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

    return pages, len(document)
