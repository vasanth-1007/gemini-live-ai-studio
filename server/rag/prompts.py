from typing import List, Tuple, Dict
from server.services.weaviate_service import RetrievedChunk

def build_context(chunks: List[RetrievedChunk], max_chars: int) -> Tuple[str, List[Dict]]:
    if not chunks:
        return "(No relevant documents found)", []

    parts = []
    sources = []
    total = 0

    for i, ch in enumerate(chunks, start=1):
        p = ch.properties or {}
        header = f"[Source {i}] (doc_no={p.get('doc_no')}, file={p.get('source_file')}, page={p.get('page')}, chunk={p.get('chunk_index')})"
        block = f"{header}\n{ch.text}\n"
        if total + len(block) > max_chars:
            break
        parts.append(block)
        total += len(block)
        sources.append({
            "id": f"source_{i}",
            "score": ch.score,
            "text_preview": ch.text_preview,
            "properties": {k: v for k, v in p.items() if k != "text"},
        })

    return "\n---\n".join(parts), sources
