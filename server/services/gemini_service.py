import asyncio
from typing import List, Optional
from cachetools import TTLCache
from tenacity import retry, stop_after_attempt, wait_exponential

from google import genai
from google.genai import types

from server.config import get_settings

class GeminiService:
    _instance: Optional["GeminiService"] = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.settings = get_settings()
        self.client = genai.Client()
        # small cache: repeated queries get same embedding quickly
        self._embed_cache = TTLCache(maxsize=2048, ttl=300)

    @classmethod
    async def get_instance(cls) -> "GeminiService":
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    def embed_texts(self, texts: List[str], task_type: str) -> List[List[float]]:
        # Gemini embeddings API. 
        result = self.client.models.embed_content(
            model=self.settings.gemini_embed_model,
            contents=texts,
            config=types.EmbedContentConfig(task_type=task_type),
        )
        return [e.values for e in result.embeddings]

    async def embed_query(self, text: str) -> List[float]:
        key = ("q", text)
        if key in self._embed_cache:
            return self._embed_cache[key]

        loop = asyncio.get_event_loop()
        vec = (await loop.run_in_executor(None, lambda: self.embed_texts([text], "RETRIEVAL_QUERY")))[0]
        self._embed_cache[key] = vec
        return vec
