"""
Kunnskapskart: plasserer tekstbitene i et 2D-kart etter betydning.

Biter som handler om det samme havner nær hverandre, så dokumentet
deler seg i "øyer" (temaer). Et spørsmål plasseres der svarene ble
funnet, slik at man ser hvor i dokumentet søket leter.
"""

import numpy as np
import umap
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer


def build_map(embeddings, chunks, n_islands=6, seed=42):
    """Lager kartet: 2D-posisjon for hver tekstbit, pluss øyer med temanavn."""
    n = len(embeddings)

    # UMAP trykker 384 dimensjoner ned til 2, men beholder hvem som er naboer.
    # cosine passer fordi søket også bruker cosine similarity.
    reducer = umap.UMAP(
        n_neighbors=min(15, n - 1),
        min_dist=0.3,
        metric="cosine",
        random_state=seed,
    )
    coords = reducer.fit_transform(embeddings)

    # Skalerer til 0–100 med litt luft i kantene, så frontenden kan bruke prosent
    mins = coords.min(axis=0)
    maxs = coords.max(axis=0)
    # Hvis alle punktene ligger likt langs en akse (f.eks. bare like tekstbiter), unngå deling på null
    span = np.where(maxs - mins > 0, maxs - mins, 1.0)
    scaled = 5 + 90 * (coords - mins) / span

    # Øyer: grupperer bitene i originalrommet (ikke 2D), så gruppene blir mer presise
    k = min(n_islands, n)
    island_ids = KMeans(n_clusters=k, random_state=seed, n_init=10).fit_predict(embeddings)

    points = []
    for i, chunk in enumerate(chunks):
        points.append(
            {
                "x": round(float(scaled[i][0]), 2),
                "y": round(float(scaled[i][1]), 2),
                "page": chunk["page_number"],
                "source": chunk["source"],
                "island": int(island_ids[i]),
            }
        )

    labels = island_labels(chunks, island_ids, k)

    islands = []
    for island in range(k):
        members = [p for p in points if p["island"] == island]
        islands.append(
            {
                "id": island,
                "x": round(float(np.mean([p["x"] for p in members])), 2),
                "y": round(float(np.mean([p["y"] for p in members])), 2),
                "label": labels[island],
                "size": len(members),
            }
        )

    return {"points": points, "islands": islands}


def island_labels(chunks, island_ids, k, words_per_label=3):
    """Gir hver øy et navn: ordene som er mest typiske for akkurat den øya.

    All tekst i en øy slås sammen til ett "dokument". TF-IDF gir høy score til
    ord som er vanlige i én øy, men sjeldne i de andre.
    """
    island_texts = [
        " ".join(c["text"] for c, island in zip(chunks, island_ids) if island == i)
        for i in range(k)
    ]
    vectorizer = TfidfVectorizer(
        stop_words="english",
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z-]{2,}\b",  # bare ord, ingen tall
        max_df=0.5,  # dropper ord som finnes i mer enn halvparten av øyene
    )
    matrix = vectorizer.fit_transform(island_texts).toarray()
    vocab = vectorizer.get_feature_names_out()

    labels = []
    for row in matrix:
        words, stems = [], set()
        for j in row.argsort()[::-1]:
            stem = vocab[j].rstrip("s")  # "cinema" og "cinemas" teller som samme ord
            if stem in stems:
                continue
            words.append(vocab[j])
            stems.add(stem)
            if len(words) == words_per_label:
                break
        labels.append(" · ".join(words))
    return labels


def place_question(points, hit_indices, scores):
    """Plasserer spørsmålet midt mellom de beste treffene, vektet etter score.

    Dette er et visningsvalg: 2D-kartet er en forenkling, så å projisere selve
    spørsmålet kan gi lange, misvisende linjer. Her havner spørsmålet der svaret
    faktisk ble funnet. Treffene med høyest score trekker mest.
    """
    weights = np.clip(np.array(scores, dtype=float), 0.01, None) ** 2
    xs = np.array([points[i]["x"] for i in hit_indices])
    ys = np.array([points[i]["y"] for i in hit_indices])
    return {
        "x": round(float(np.average(xs, weights=weights)), 2),
        "y": round(float(np.average(ys, weights=weights)), 2),
    }
