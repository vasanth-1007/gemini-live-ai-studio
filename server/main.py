import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from server.config import get_settings
from server.services.gemini_service import GeminiService
from server.services.weaviate_service import WeaviateService
from server.rag.prompts import build_context

logger = logging.getLogger("rag-server")
logging.basicConfig(level=logging.INFO)

settings = get_settings()
gemini_service: Optional[GeminiService] = None
weaviate_service: Optional[WeaviateService] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global gemini_service, weaviate_service
    weaviate_service = await WeaviateService.get_instance()
    gemini_service = await GeminiService.get_instance()
    yield
    if weaviate_service:
        weaviate_service.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RetrieveReq(BaseModel):
    query: str
    # NEW: Allow top_k override for tool calls
    top_k: Optional[int] = None

class RetrieveResp(BaseModel):
    context: str
    sources: list[dict]

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/api/retrieve", response_model=RetrieveResp)
async def retrieve(req: RetrieveReq):
    q = (req.query or "").strip()
    if not q:
        return {"context": "(Empty query)", "sources": []}

    qvec = await gemini_service.embed_query(q)
    
    # Use request top_k if provided, otherwise default to settings
    k = req.top_k if req.top_k else settings.top_k
    
    chunks = weaviate_service.retrieve(query=q, query_vector=qvec, top_k=k)
    context, sources = build_context(chunks, settings.max_context_chars)
    return {"context": context, "sources": sources}
