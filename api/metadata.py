"""
Kildeinformasjon (forfattere, år, tittel, tidsskrift) for referanser.

1. Finner en DOI på de første sidene, eller en arXiv-id, som også har en DOI.
2. Slår opp DOI-en via doi.org, som svarer med CSL-JSON for både Crossref- og
   DataCite-DOI-er. Det er gratis og krever ingen nøkkel.
3. Uten DOI gjettes tittelen fra PDF-en (den største teksten på første side),
   og tittelen søkes opp i Crossref. Mange PDF-er, for eksempel fra JSTOR, har
   ikke DOI-en trykt i teksten. Treffet brukes bare hvis tittelen er nesten lik.
4. Ellers brukes gjetningen fra PDF-en, og brukeren kan rette opp.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

import pymupdf

DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
ARXIV = re.compile(r"arXiv:\s?(\d{4}\.\d{4,5})", re.I)
YEAR = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
COPYRIGHT = re.compile(r"©|\(c\)|copyright", re.I)
LICENCE_LINE = re.compile(r"exclusive use|downloaded|licensed to|for use by|printed by|all rights reserved by", re.I)


def find_doi(text):
    match = DOI.search(text)
    if match:
        return match.group(1).rstrip(".,;)]}")
    match = ARXIV.search(text)
    if match:
        return f"10.48550/arXiv.{match.group(1)}"
    return None


USER_AGENT = "ResearchCopilot/0.1 (https://github.com/ayuubhsn/research-copilot)"


def fetch_json(url, accept="application/json", timeout=6):
    request = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def fetch_csl(doi, timeout=6):
    """CSL-JSON for en DOI fra doi.org, eller None hvis den ikke finnes eller nettet svikter."""
    return fetch_json(f"https://doi.org/{doi}", "application/vnd.citationstyles.csl+json", timeout)


def same_title(a, b):
    """Nesten like titler, uavhengig av store bokstaver, tegnsetting og mellomrom."""
    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
    return SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.92


def search_title(title, year=None, timeout=6):
    """DOI for en artikkel med denne tittelen i Crossref, eller None.

    Krever nesten lik tittel, og samme år (±1) hvis året er kjent, så en
    annen artikkel med lignende navn ikke blir valgt.
    """
    if len(title) < 12:
        return None
    query = urllib.parse.urlencode({"query.bibliographic": title, "rows": 5, "select": "DOI,title,issued"})
    found = fetch_json(f"https://api.crossref.org/works?{query}", timeout=timeout)
    for item in (found or {}).get("message", {}).get("items", []):
        candidate = (item.get("title") or [""])[0]
        issued = (item.get("issued", {}).get("date-parts") or [[None]])[0][0]
        if same_title(candidate, title) and (not year or not issued or abs(issued - year) <= 1):
            return item.get("DOI")
    return None


def citation_for_doi(doi):
    csl = fetch_csl(doi)
    return from_csl(csl, doi) if csl and csl.get("title") else None


# CSL-typer slått sammen til de få typene referansestilene skiller mellom
CSL_TYPES = {
    "journal-article": "article",
    "article-journal": "article",
    "paper-conference": "conference",
    "proceedings-article": "conference",
    "book": "book",
    "monograph": "book",
    "chapter": "chapter",
    "book-chapter": "chapter",
    "report": "report",
    "posted-content": "preprint",
}


def from_csl(csl, doi):
    def first(value):
        return value[0] if isinstance(value, list) and value else value or ""

    date = csl.get("issued", {}).get("date-parts", [[None]])[0]
    return {
        "title": first(csl.get("title")).strip(),
        "authors": [
            {"family": a.get("family") or a.get("literal", ""), "given": a.get("given", "")}
            for a in csl.get("author", [])
            if a.get("family") or a.get("literal")
        ],
        "year": date[0] if date and date[0] else None,
        "container": first(csl.get("container-title")) or csl.get("publisher", ""),
        "volume": str(csl.get("volume", "") or ""),
        "issue": str(csl.get("issue", "") or ""),
        "pages": str(csl.get("page", "") or ""),
        "doi": doi,
        "type": "preprint" if doi.lower().startswith("10.48550/") else CSL_TYPES.get(csl.get("type", ""), "article"),
        "publisher": csl.get("publisher", ""),
        "source": "doi",
    }


def guess_from_pdf(pdf_bytes, filename):
    """Tittel, år og type fra PDF-en selv, når DOI-oppslaget ikke gir noe."""
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        info = pdf.metadata or {}
        title = (info.get("title") or "").strip()
        first_page = pdf[0] if len(pdf) else None
        text = first_page.get_text() if first_page else ""

        # Tittelen er som regel den største vannrette teksten øverst på første side.
        # Loddrett tekst (som arXiv-stempelet i margen) og stempler hoppes over.
        if first_page and len(title) < 8:
            top = first_page.rect.height * 0.45
            spans = [
                s
                for block in first_page.get_text("dict")["blocks"]
                for line in block.get("lines", [])
                if abs(line["dir"][0]) > 0.99 and line["bbox"][1] < top
                for s in line["spans"]
                if len(s["text"].strip()) > 2 and not ARXIV.search(s["text"])
            ]
            if spans:
                sizes = sorted(s["size"] for s in spans)
                biggest, typical = sizes[-1], sizes[len(sizes) // 2]
                guess = " ".join(s["text"].strip() for s in spans if s["size"] >= biggest - 0.5)
                # Bare hvis tittelen faktisk skiller seg ut fra brødteksten og er kort nok
                if biggest >= typical * 1.15 and len(guess) <= 250:
                    title = guess

    arxiv = ARXIV.search(text)
    if arxiv:
        # arXiv-id-en begynner med år og måned: 2307 = juli 2023
        year = 2000 + int(arxiv.group(1)[:2])
    else:
        # Et år etter "©" eller "Copyright" er det sikreste. Ellers er artikkelens eget år som
        # regel det nyeste på første side. Linjer om lisens og nedlasting ("For the exclusive
        # use of …, 2026") gjelder når filen ble lastet ned, ikke når artikkelen kom ut.
        now = time.localtime().tm_year
        lines = [ln for ln in text.splitlines() if not LICENCE_LINE.search(ln)]
        copyright_years = [int(y) for ln in lines if COPYRIGHT.search(ln) for y in YEAR.findall(ln) if int(y) <= now]
        years = [int(y) for ln in lines for y in YEAR.findall(ln) if int(y) <= now]
        year = min(copyright_years) if copyright_years else (max(years) if years else None)
    return {
        "title": " ".join(title.split()) or filename.rsplit(".", 1)[0],
        "authors": [],
        "year": year,
        "container": "arXiv" if arxiv else "",
        "volume": "",
        "issue": "",
        "pages": "",
        "doi": None,
        "type": "preprint" if arxiv else "article",
        "publisher": "",
        "source": "pdf",
    }


def lookup(pdf_bytes, pages, filename):
    first_pages = " ".join(p["text"] for p in pages[:2])
    doi = find_doi(first_pages)
    if doi:
        found = citation_for_doi(doi)
        if found:
            return found

    citation = guess_from_pdf(pdf_bytes, filename)
    if not doi:
        doi = search_title(citation["title"], citation["year"])
        found = citation_for_doi(doi) if doi else None
        if found:
            return found
    citation["doi"] = doi
    return citation
