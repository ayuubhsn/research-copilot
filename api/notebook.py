"""
Notatboken: sitater brukeren har lagret, med artikkel, side, eget notat og merkelapper.

Lagres som én JSON-fil i data-mappen, så den overlever en omstart.
"""

import json
import time
import uuid
from pathlib import Path


class Notebook:
    def __init__(self, folder):
        self.path = Path(folder) / "notebook.json"
        self.notes = json.loads(self.path.read_text()) if self.path.exists() else []

    def _save(self):
        self.path.write_text(json.dumps(self.notes, ensure_ascii=False, indent=1))

    def all(self):
        return self.notes

    def add(self, doc_id, page, text, rects, note="", tags=()):
        entry = {
            "id": uuid.uuid4().hex[:10],
            "docId": doc_id,
            "page": page,
            "text": " ".join(text.split()),
            "rects": rects,
            "note": note,
            "tags": list(tags),
            "created": int(time.time()),
        }
        self.notes.append(entry)
        self._save()
        return entry

    def update(self, note_id, note=None, tags=None):
        for entry in self.notes:
            if entry["id"] == note_id:
                if note is not None:
                    entry["note"] = note
                if tags is not None:
                    entry["tags"] = list(tags)
                self._save()
                return entry
        return None

    def delete(self, note_id):
        before = len(self.notes)
        self.notes = [n for n in self.notes if n["id"] != note_id]
        self._save()
        return len(self.notes) < before

    def delete_document(self, doc_id):
        self.notes = [n for n in self.notes if n["docId"] != doc_id]
        self._save()
