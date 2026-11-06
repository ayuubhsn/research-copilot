"""
Finner hvor en tekst står på en PDF-side, så frontenden kan markere den i gult.

PyMuPDF gir hvert ord på siden med koordinater. Både ordene på siden og
teksten vi leter etter (en tekstbit eller et sitat fra faktasjekken)
gjøres om til bare bokstaver og tall, uten mellomrom og tegn. Da spiller
det ingen rolle om et ord er delt over et linjeskift ("infor- mation")
eller om PDF-en har andre mellomrom enn teksten. Vi finner teksten i denne
strengen og vet for hvert tegn hvilket ord det kom fra.

Ordene i treffet slås sammen til ett rektangel per linje. Koordinatene
returneres som andeler av sidens bredde og høyde (0–1), så frontenden kan
tegne dem uansett hvor stor siden vises.
"""

import re

NOT_ALNUM = re.compile(r"[\W_]+")


def squash(text):
    """Bare bokstaver og tall, i små bokstaver."""
    return NOT_ALNUM.sub("", text).lower()


def page_stream(page):
    """Hele siden som én streng, pluss hvilket ord hvert tegn kom fra."""
    words = page.get_text("words")
    chars, owner = [], []
    for i, w in enumerate(words):
        s = squash(w[4])
        chars.append(s)
        owner.extend([i] * len(s))
    return "".join(chars), owner, words


def find_span(stream, target, probe=40):
    """Første og siste tegnposisjon for target i stream, eller None.

    Prøver først hele teksten. PDF-tekst kan avvike litt fra den uttrukne
    teksten (ligaturer, spesialtegn), så hvis det ikke går, leter vi etter
    starten og slutten hver for seg og tar alt imellom.
    """
    if not target:
        return None
    i = stream.find(target)
    if i >= 0:
        return i, i + len(target) - 1

    k = min(probe, len(target))
    start = stream.find(target[:k])
    if start < 0:
        return None
    end = stream.find(target[-k:], start)
    # Slutten må ligge omtrent så langt unna som teksten er lang
    if end < 0 or end + k - start > len(target) * 1.3 + k:
        return None
    return start, end + k - 1


def locate(page, text):
    """Rektangler (andeler 0–1) for teksten på siden, ett per linje. Tom liste hvis ikke funnet."""
    stream, owner, words = page_stream(page)
    span = find_span(stream, squash(text))
    if span is None:
        return []

    first, last = owner[span[0]], owner[span[1]]
    width, height = page.rect.width, page.rect.height
    lines = {}
    for w in words[first : last + 1]:
        key = (w[5], w[6])  # blokk og linje
        x0, y0, x1, y1 = lines.get(key, (w[0], w[1], w[2], w[3]))
        lines[key] = (min(x0, w[0]), min(y0, w[1]), max(x1, w[2]), max(y1, w[3]))

    return [
        {
            "x": round(x0 / width, 4),
            "y": round(y0 / height, 4),
            "w": round((x1 - x0) / width, 4),
            "h": round((y1 - y0) / height, 4),
        }
        for x0, y0, x1, y1 in lines.values()
    ]
