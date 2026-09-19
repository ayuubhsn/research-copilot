def chunk_pages(pages, chunk_size=500, overlap=50):
    """Deler PDF-sider opp i mindre tekstbiter med overlapp."""
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    chunks = []
    step_size = chunk_size - overlap

    for page_data in pages:
        text = page_data["text"]
        page_number = page_data["page_number"]

        for start_index in range(0, len(text), step_size):
            chunk_text = text[start_index:start_index + chunk_size].strip()

            if chunk_text:
                chunks.append(
                    {
                        "text": chunk_text,
                        "page_number": page_number,
                    }
                )

    return chunks
