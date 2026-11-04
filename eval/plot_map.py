"""
Tegner kunnskapskartet for en PDF og viser hvor noen spørsmål havner.

Kjør fra prosjektmappen:
    python eval/plot_map.py
Resultatet lagres i eval/map.html, som du åpner i nettleseren.
"""

import sys
from pathlib import Path

import plotly.graph_objects as go

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.chunking import chunk_pages
from src.knowledge_map import build_map, place_question
from src.pdf_processor import extract_pages
from src.rag import create_embeddings, create_faiss_index, load_embedding_model, search_chunks

PDF = ROOT / "eval" / "papers" / "lost_in_the_middle.pdf"
OUT = ROOT / "eval" / "map.html"

QUESTIONS = [
    "What is the closed-book accuracy of GPT-3.5-Turbo on the multi-document QA task?",
    "What is query-aware contextualization and what effect did it have?",
    "Which phenomenon from psychology do the authors compare their results to?",
]

ISLAND_COLORS = ["#7CC4A4", "#8CA3FF", "#E9A86B", "#C99BE0", "#6FC3D9", "#D9C36F", "#E58A9A", "#9AB87A"]
QUESTION_COLORS = ["#F2D04B", "#FF8A65", "#F2F2F2"]


def main():
    pages, _ = extract_pages(PDF.read_bytes())
    chunks = chunk_pages(pages, source=PDF.name)

    model = load_embedding_model()
    embeddings = create_embeddings(chunks, model)
    index = create_faiss_index(embeddings)

    map_model = build_map(embeddings, chunks)
    points = map_model["points"]
    position_of = {c["text"]: i for i, c in enumerate(chunks)}

    fig = go.Figure()

    # Én prikkserie per øy, så hver øy får sin farge i forklaringen
    for island in map_model["islands"]:
        members = [i for i, p in enumerate(points) if p["island"] == island["id"]]
        fig.add_trace(
            go.Scatter(
                x=[points[i]["x"] for i in members],
                y=[points[i]["y"] for i in members],
                mode="markers",
                marker={"size": 8, "color": ISLAND_COLORS[island["id"] % len(ISLAND_COLORS)], "opacity": 0.75},
                name=island["label"],
                text=[f"p.{chunks[i]['page_number']}: {chunks[i]['text'][:110]}…" for i in members],
                hoverinfo="text",
            )
        )
        fig.add_annotation(x=island["x"], y=island["y"] + 6, text=island["label"], showarrow=False,
                           font={"color": "#A3ABA6", "size": 12})

    # Hvert spørsmål plasseres på kartet, med linjer til de fem treffene
    for q_i, question in enumerate(QUESTIONS):
        color = QUESTION_COLORS[q_i % len(QUESTION_COLORS)]
        results = search_chunks(question, model, index, chunks, top_k=5)
        hit_indices = [position_of[r["text"]] for r in results]
        # Plasseres ved de tre beste treffene; linjer tegnes til alle fem
        q_pos = place_question(points, hit_indices[:3], [r["score"] for r in results[:3]])

        for r in results:
            hit = points[position_of[r["text"]]]
            fig.add_trace(
                go.Scatter(
                    x=[q_pos["x"], hit["x"]], y=[q_pos["y"], hit["y"]],
                    mode="lines", line={"color": color, "width": 1.5},
                    opacity=0.35 + 0.6 * max(r["score"], 0),
                    hoverinfo="skip", showlegend=False,
                )
            )

        fig.add_trace(
            go.Scatter(
                x=[q_pos["x"]], y=[q_pos["y"]], mode="markers",
                marker={"size": 18, "color": color, "symbol": "star", "line": {"color": "#0E1211", "width": 1}},
                name=question[:45] + "…",
                text=[question + "<br>" + " · ".join(f"p.{r['page_number']} ({r['score']:.2f})" for r in results)],
                hoverinfo="text",
            )
        )

    fig.update_layout(
        title=f"Knowledge map of {PDF.name} ({len(chunks)} passages)",
        paper_bgcolor="#0E1211", plot_bgcolor="#0B0F0E", font={"color": "#ECEDE8"},
        xaxis={"visible": False, "range": [0, 100]}, yaxis={"visible": False, "range": [0, 100]},
        height=720, legend={"bgcolor": "rgba(0,0,0,0)"},
    )
    fig.write_html(OUT, include_plotlyjs="cdn")
    print(f"{len(chunks)} passages, {len(map_model['islands'])} islands. Saved {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
