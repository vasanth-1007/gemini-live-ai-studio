from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional, List

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: List[str] = ["http://localhost:3000"]

    # Weaviate
    is_weaviate_cloud: bool = False
    weaviate_url: Optional[str] = None     # for cloud, e.g. https://xxx.weaviate.network
    weaviate_api_key: Optional[str] = None
    weaviate_collection: str = "SOPChunks"
    weaviate_tenant: Optional[str] = None  # optional MT
    weaviate_target_vector: Optional[str] = None

    # local/custom
    http_host: str = "127.0.0.1"
    http_port: int = 8080
    http_secure: bool = False
    grpc_host: str = "127.0.0.1"
    grpc_port: int = 50051
    grpc_secure: bool = False

    # RAG
    top_k: int = 6
    max_context_chars: int = 9000
    weaviate_text_property: str = "text"
    extra_properties: List[str] = ["doc_no", "source_file", "page", "chunk_index", "doc_id"]

    # Gemini
    gemini_embed_model: str = "gemini-embedding-001"
    # (Backend only needs embeddings; Live stays in the browser for latency.)

    # Ingestion / chunking
    chunk_chars: int = 1500
    chunk_overlap: int = 200
    max_pages_ingest: int = 50  # protect your server

def get_settings() -> Settings:
    return Settings()
