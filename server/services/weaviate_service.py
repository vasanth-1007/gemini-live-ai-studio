import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import weaviate
import weaviate.classes.config as wvcc
from weaviate.classes.init import Auth, AdditionalConfig, Timeout
from weaviate.classes.query import MetadataQuery

from server.config import get_settings

@dataclass
class RetrievedChunk:
    text: str
    score: Optional[float]
    properties: Dict[str, Any]

    @property
    def text_preview(self) -> str:
        t = self.text or ""
        return (t[:220] + "...") if len(t) > 220 else t

class WeaviateService:
    _instance: Optional["WeaviateService"] = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.settings = get_settings()
        self.client = self._connect()
        self._ensure_collection()

    @classmethod
    async def get_instance(cls) -> "WeaviateService":
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def close(self):
        try:
            self.client.close()
        except Exception:
            pass

    def _connect(self) -> weaviate.WeaviateClient:
        timeout_config = AdditionalConfig(timeout=Timeout(init=30, query=60, insert=120))
        auth = Auth.api_key(self.settings.weaviate_api_key) if self.settings.weaviate_api_key else None

        if self.settings.is_weaviate_cloud:
            if not self.settings.weaviate_url:
                raise RuntimeError("WEAVIATE_URL is required for cloud mode")
            client = weaviate.connect_to_weaviate_cloud(
                cluster_url=self.settings.weaviate_url,
                auth_credentials=auth,
                additional_config=timeout_config,
                skip_init_checks=False,
            )
        else:
            client = weaviate.connect_to_custom(
                http_host=self.settings.http_host,
                http_port=self.settings.http_port,
                http_secure=self.settings.http_secure,
                grpc_host=self.settings.grpc_host,
                grpc_port=self.settings.grpc_port,
                grpc_secure=self.settings.grpc_secure,
                auth_credentials=auth,
                additional_config=timeout_config,
                skip_init_checks=False,
            )

        if not client.is_ready():
            raise RuntimeError("Weaviate not ready")
        return client

    def _collection(self):
        c = self.client.collections.get(self.settings.weaviate_collection)
        if self.settings.weaviate_tenant:
            c = c.with_tenant(self.settings.weaviate_tenant)
        return c

    def _ensure_collection(self):
        # If you already created it with your pipeline, this is a no-op.
        existing = self.client.collections.list_all()
        if self.settings.weaviate_collection in existing:
            return

        self.client.collections.create(
            name=self.settings.weaviate_collection,
            vector_config=wvcc.Configure.Vectors.self_provided(
                vector_index_config=wvcc.Configure.VectorIndex.hnsw(
                    distance_metric=wvcc.VectorDistances.COSINE
                )
            ),
            properties=[
                wvcc.Property(name="doc_id", data_type=wvcc.DataType.TEXT),
                wvcc.Property(name="doc_no", data_type=wvcc.DataType.TEXT),
                wvcc.Property(name="source_file", data_type=wvcc.DataType.TEXT),
                wvcc.Property(name="page", data_type=wvcc.DataType.INT),
                wvcc.Property(name="chunk_index", data_type=wvcc.DataType.INT),
                wvcc.Property(name="text", data_type=wvcc.DataType.TEXT),
            ],
        )

    def retrieve(self, query: str, query_vector: List[float], top_k: int) -> List[RetrievedChunk]:
        # Hybrid search combines lexical + vector. 
        c = self._collection()
        props = list(dict.fromkeys([self.settings.weaviate_text_property] + self.settings.extra_properties))
        meta = MetadataQuery(score=True)

        kwargs = dict(
            query=query,
            vector=query_vector,
            limit=top_k,
            return_properties=props,
            return_metadata=meta,
        )
        if self.settings.weaviate_target_vector:
            kwargs["target_vector"] = self.settings.weaviate_target_vector

        res = c.query.hybrid(**kwargs)
        out: List[RetrievedChunk] = []
        for obj in res.objects:
            p = obj.properties or {}
            text = p.get(self.settings.weaviate_text_property)
            if not isinstance(text, str) or not text.strip():
                continue
            md = getattr(obj, "metadata", None)
            out.append(RetrievedChunk(
                text=text.strip(),
                score=getattr(md, "score", None),
                properties=p,
            ))
        return out
