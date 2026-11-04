import re

# Mønstre som går igjen i referanselister: lenker, DOI-er og "(2018)." / "(n.d.)."
REFERENCE_PATTERN = re.compile(
    r"https?://|doi\.org|\(\d{4}[a-z]?(?:, [A-Z][a-z]+ \d{1,2})?\)\.|\(n\.d\.[^)]*\)\."
)

# En setning slutter med . ! eller ? etterfulgt av mellomrom og stor bokstav/tall.
# Da deles ikke "et al. (2018)" eller "p. 187" opp midt i en setning.
SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])")


def is_noise(text):
    """Sjekker om en tekstbit er innholdsfortegnelse eller referanseliste."""
    # Innholdsfortegnelser har mange prikkrader: "Introduction ........ 5"
    if text.count("....") >= 3:
        return True

    # Referanselister har flere lenker eller årstall-sitater i samme bit
    if len(REFERENCE_PATTERN.findall(text)) >= 2:
        return True

    return False


def split_sentences(text):
    """Deler tekst i setninger og fjerner linjeskift fra PDF-en."""
    text = re.sub(r"\s+", " ", text).strip()
    return [s for s in SENTENCE_END.split(text) if s]


def chunk_pages(pages, chunk_size=500, overlap_sentences=1, source="unknown"):
    """Deler PDF-sider i biter av hele setninger, med én setning overlapp."""
    chunks = []

    for page_data in pages:
        page_texts = []
        current = []

        for sentence in split_sentences(page_data["text"]):
            # Start en ny bit når neste setning ville gjort den for lang
            if current and len(" ".join(current + [sentence])) > chunk_size:
                page_texts.append(" ".join(current))
                # Siste setning tas med videre, så sammenhengen ikke brytes
                current = current[-overlap_sentences:] if overlap_sentences else []
            current.append(sentence)

        if current:
            tail = " ".join(current)
            # En kort rest slås sammen med forrige bit i stedet for å stå alene
            if page_texts and len(tail) < chunk_size // 4:
                page_texts[-1] += " " + tail[len(current[0]):].strip() if overlap_sentences else " " + tail
            else:
                page_texts.append(tail)

        for text in page_texts:
            # Hopper over støy og nesten tomme biter (f.eks. sider med bare sidetall)
            if len(text) >= 30 and not is_noise(text):
                chunks.append(
                    {"text": text, "page_number": page_data["page_number"], "source": source}
                )

    return chunks
