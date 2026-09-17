# embedding_service.py
"""Sentence-transformer embedding service (CPU-only).

Generates the fixed 32-vector document representation (20 skills, 10
responsibilities, 1 experience, 1 job title) and provides vectorized cosine
similarity used by the matching service. This deployment is CPU-only; the
math libraries are thread-bounded (see TORCH_NUM_THREADS) so multiple
containers sharing a host don't oversubscribe the CPUs.
"""

import hashlib
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

from app.core.config import settings

logger = logging.getLogger(__name__)

# Bound the CPU math libraries once, at import time.
try:
    _threads = max(1, int(getattr(settings, "TORCH_NUM_THREADS", 1)))
    torch.set_num_threads(_threads)
except Exception:  # pragma: no cover - defensive
    pass

# Global shared model instance (singleton: all workers share one model)
_shared_model = None
_model_lock = threading.Lock()
_model_device = "cpu"

# Bound for the in-memory fallback cache so long-running workers don't grow
# without limit.
_IN_MEMORY_CACHE_MAX = 5000


class EmbeddingService:
    """
    Consolidated service for all embedding operations.
    Uses the configured sentence-transformer model (768 dimensions by default).
    """

    SIMILARITY_THRESHOLDS = {
        "skills": {
            "excellent": 0.80,
            "good": 0.70,
            "moderate": 0.60,
            "minimum": 0.50
        },
        "responsibilities": {
            "excellent": 0.75,
            "good": 0.65,
            "moderate": 0.55,
            "minimum": 0.45
        }
    }

    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or settings.EMBEDDING_MODEL_NAME
        self.batch_size = settings.EMBEDDING_BATCH_SIZE
        self._embedding_cache: "OrderedDict[str, np.ndarray]" = OrderedDict()
        self._cache_lock = threading.Lock()

        # CPU-only deployment.
        self.device = "cpu"

        try:
            from app.utils.redis_cache import get_redis_cache
            self.redis_cache = get_redis_cache()
        except Exception as e:
            logger.warning(f"Redis cache not available for embeddings: {e}")
            self.redis_cache = None

        self._initialize_shared_model()
        self.model = _shared_model
        if self.model is None:
            raise Exception("Shared embedding model failed to initialize")

        logger.info(f"EmbeddingService ready: model={self.model_name} device={self.device}")

    def _initialize_shared_model(self) -> None:
        """Initialize the shared model instance (thread-safe singleton)."""
        global _shared_model, _model_device
        if _shared_model is not None:
            return
        with _model_lock:
            if _shared_model is not None:
                return
            logger.info(f"Loading shared embedding model: {self.model_name} on {self.device}")
            _shared_model = SentenceTransformer(self.model_name, device=self.device)
            _model_device = self.device

    # ------------------------------------------------------------------
    # Caching helpers
    # ------------------------------------------------------------------

    def _cache_key(self, clean_text: str) -> str:
        digest = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
        return f"emb:{self.model_name}:{digest}"

    def _memory_cache_get(self, key: str) -> Optional[np.ndarray]:
        with self._cache_lock:
            value = self._embedding_cache.get(key)
            if value is not None:
                self._embedding_cache.move_to_end(key)
            return value

    def _memory_cache_set(self, key: str, value: np.ndarray) -> None:
        with self._cache_lock:
            self._embedding_cache[key] = value
            self._embedding_cache.move_to_end(key)
            while len(self._embedding_cache) > _IN_MEMORY_CACHE_MAX:
                self._embedding_cache.popitem(last=False)

    # ------------------------------------------------------------------
    # Embedding generation
    # ------------------------------------------------------------------

    def generate_document_embeddings(self, structured_data: dict) -> dict:
        """
        Generate EXACTLY 32 vectors per document:
        20 skills + 10 responsibilities + 1 experience + 1 job title.
        """
        try:
            embeddings = {}

            skills = structured_data.get("skills_sentences", structured_data.get("skills", []))[:20]
            while len(skills) < 20:
                skills.append("General professional skills and competencies")

            skill_texts = [s if s and str(s).strip() else "General professional skills" for s in skills]
            skill_matrix = self._encode_batch(skill_texts)
            embeddings["skill_vectors"] = [v.tolist() for v in skill_matrix]
            embeddings["skills"] = skills

            responsibilities = structured_data.get(
                "responsibility_sentences", structured_data.get("responsibilities", [])
            )[:10]
            while len(responsibilities) < 10:
                responsibilities.append("General professional responsibilities and duties")

            resp_texts = [r if r and str(r).strip() else "General professional responsibilities" for r in responsibilities]
            resp_matrix = self._encode_batch(resp_texts)
            embeddings["responsibility_vectors"] = [v.tolist() for v in resp_matrix]
            embeddings["responsibilities"] = responsibilities

            experience_text = str(structured_data.get("experience_years", "0") or "0")
            if not experience_text.strip():
                experience_text = "0 years"
            experience_vector = self.generate_single_embedding(f"Experience: {experience_text} years")
            embeddings["experience_vector"] = [experience_vector.tolist()]
            embeddings["experience_years"] = experience_text

            job_title = structured_data.get("job_title", "")
            if not job_title or not str(job_title).strip():
                job_title = "Professional"
            job_title_vector = self.generate_single_embedding(job_title)
            embeddings["job_title_vector"] = [job_title_vector.tolist()]
            embeddings["job_title"] = job_title

            total_vectors = (
                len(embeddings["skill_vectors"])
                + len(embeddings["responsibility_vectors"])
                + len(embeddings["experience_vector"])
                + len(embeddings["job_title_vector"])
            )
            if total_vectors != 32:
                raise ValueError(f"Expected exactly 32 vectors, got {total_vectors}")

            logger.info("Generated exactly 32 vectors (20 skills + 10 resp + 1 exp + 1 title)")
            return embeddings

        except Exception as e:
            logger.error(f"Failed to generate document embeddings: {str(e)}")
            raise Exception(f"Document embedding generation failed: {str(e)}")

    def _encode_batch(self, texts: List[str]) -> List[np.ndarray]:
        """Encode a list of texts, using per-text caches where possible."""
        clean_texts = [self._prepare_text(t) for t in texts]
        results: List[Optional[np.ndarray]] = [None] * len(clean_texts)
        to_encode: List[str] = []
        to_encode_idx: List[int] = []

        for i, clean in enumerate(clean_texts):
            cached = self._lookup_cached(clean)
            if cached is not None:
                results[i] = cached
            else:
                to_encode.append(clean)
                to_encode_idx.append(i)

        if to_encode:
            encoded = self.model.encode(
                to_encode, convert_to_tensor=False,
                batch_size=self.batch_size, show_progress_bar=False,
            )
            if isinstance(encoded, torch.Tensor):
                encoded = encoded.cpu().numpy()
            for pos, idx in enumerate(to_encode_idx):
                vec = np.asarray(encoded[pos], dtype=np.float32)
                results[idx] = vec
                self._store_cached(clean_texts[idx], vec)

        return [r for r in results if r is not None]

    def _lookup_cached(self, clean_text: str) -> Optional[np.ndarray]:
        key = self._cache_key(clean_text)
        if self.redis_cache:
            try:
                cached = self.redis_cache.get(key, "embeddings")
                if cached is not None:
                    return np.array(cached, dtype=np.float32)
            except Exception as e:
                logger.debug(f"Redis cache read failed: {e}")
        return self._memory_cache_get(key)

    def _store_cached(self, clean_text: str, embedding: np.ndarray) -> None:
        key = self._cache_key(clean_text)
        if self.redis_cache:
            try:
                self.redis_cache.set(
                    key, embedding.tolist(), settings.EMBEDDING_CACHE_TTL_SECONDS, "embeddings"
                )
            except Exception as e:
                logger.debug(f"Redis cache write failed: {e}")
        self._memory_cache_set(key, embedding)

    def generate_single_embedding(self, text: str) -> np.ndarray:
        """Generate a single embedding for any text (cached)."""
        if not text or not text.strip():
            raise ValueError("Empty text provided for embedding")

        clean_text = self._prepare_text(text)
        cached = self._lookup_cached(clean_text)
        if cached is not None:
            return cached

        try:
            start_time = time.time()
            embedding = self.model.encode(clean_text, convert_to_tensor=False)
            if isinstance(embedding, torch.Tensor):
                embedding = embedding.cpu().numpy()
            embedding = np.asarray(embedding, dtype=np.float32)

            self._store_cached(clean_text, embedding)
            logger.debug(f"Embedding generated in {time.time() - start_time:.3f}s")
            return embedding
        except Exception as e:
            logger.error(f"Embedding generation failed: {str(e)}")
            raise Exception(f"Embedding generation failed: {str(e)}")

    def generate_skill_embeddings(self, skills: List[str]) -> Dict[str, np.ndarray]:
        """Generate embeddings for each skill (batched, cached)."""
        return self._generate_text_embeddings(skills, "skills")

    def generate_responsibility_embeddings(self, responsibilities: List[str]) -> Dict[str, np.ndarray]:
        """Generate embeddings for each responsibility (batched, cached)."""
        return self._generate_text_embeddings(responsibilities, "responsibilities")

    def _generate_text_embeddings(self, items: List[str], label: str) -> Dict[str, np.ndarray]:
        valid_items = [item for item in items if item and item.strip()]
        if not valid_items:
            return {}
        start_time = time.time()
        vectors = self._encode_batch(valid_items)
        result = dict(zip(valid_items, vectors))
        logger.info(f"Generated {len(result)} {label} embeddings in {time.time() - start_time:.3f}s")
        return result

    # ------------------------------------------------------------------
    # Similarity
    # ------------------------------------------------------------------

    def calculate_cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Cosine similarity between two vectors, clamped to [0, 1]."""
        try:
            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)
            if norm1 == 0 or norm2 == 0:
                return 0.0
            cosine_sim = np.dot(vec1, vec2) / (norm1 * norm2)
            return max(0.0, min(1.0, float(cosine_sim)))
        except Exception as e:
            logger.error(f"Similarity calculation failed: {str(e)}")
            return 0.0

    def calculate_batch_cosine_similarity(self, matrix_a: np.ndarray, matrix_b: np.ndarray) -> np.ndarray:
        """Vectorized pairwise cosine similarity matrix (n_a x n_b), clamped to [0, 1]."""
        try:
            norm_a = np.linalg.norm(matrix_a, axis=1, keepdims=True)
            norm_b = np.linalg.norm(matrix_b, axis=1, keepdims=True)
            norm_a = np.where(norm_a == 0, 1, norm_a)
            norm_b = np.where(norm_b == 0, 1, norm_b)
            similarity_matrix = np.dot(matrix_a / norm_a, (matrix_b / norm_b).T)
            return np.clip(similarity_matrix, 0.0, 1.0)
        except Exception as e:
            logger.error(f"Batch similarity calculation failed: {str(e)}")
            return np.zeros((matrix_a.shape[0], matrix_b.shape[0]))

    def calculate_similarity_matrix(
        self, embeddings1: Dict[str, np.ndarray], embeddings2: Dict[str, np.ndarray]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Per-item ranked similarity between two embedding dicts."""
        keys1 = list(embeddings1.keys())
        keys2 = list(embeddings2.keys())
        if not keys1 or not keys2:
            return {k: [] for k in keys1}

        matrix = self.calculate_batch_cosine_similarity(
            np.array([embeddings1[k] for k in keys1]),
            np.array([embeddings2[k] for k in keys2]),
        )
        similarity_matrix = {}
        for i, key1 in enumerate(keys1):
            similarities = [
                {"item": key2, "similarity": float(matrix[i, j])}
                for j, key2 in enumerate(keys2)
            ]
            similarities.sort(key=lambda x: x["similarity"], reverse=True)
            similarity_matrix[key1] = similarities
        return similarity_matrix

    def get_match_quality(self, similarity: float, category: str) -> str:
        """Map a similarity score to a quality bucket for the given category."""
        if category not in self.SIMILARITY_THRESHOLDS:
            category = "skills"
        thresholds = self.SIMILARITY_THRESHOLDS[category]
        if similarity >= thresholds["excellent"]:
            return "excellent"
        elif similarity >= thresholds["good"]:
            return "good"
        elif similarity >= thresholds["moderate"]:
            return "moderate"
        elif similarity >= thresholds["minimum"]:
            return "minimum"
        return "unmatched"

    def _prepare_text(self, text: str) -> str:
        """Clean and prepare text for embedding."""
        clean_text = " ".join(str(text).split())
        max_length = 512
        if len(clean_text) > max_length:
            clean_text = clean_text[:max_length]
        return clean_text

    def get_embedding_dimension(self) -> int:
        if self.model:
            return self.model.get_sentence_embedding_dimension()
        return settings.EMBEDDING_DIM

    def health_check(self) -> Dict[str, Any]:
        return {
            "service": "embedding_service",
            "model": self.model_name,
            "device": str(self.device),
            "embedding_dimension": self.get_embedding_dimension(),
            "cache_size": len(self._embedding_cache),
            "model_loaded": self.model is not None,
        }

    def clear_cache(self) -> None:
        with self._cache_lock:
            self._embedding_cache.clear()
        logger.info("Embedding cache cleared")


# Global instance
_embedding_service: Optional[EmbeddingService] = None
_service_lock = threading.Lock()


def get_embedding_service() -> EmbeddingService:
    """Get global embedding service instance (thread-safe)."""
    global _embedding_service
    if _embedding_service is None:
        with _service_lock:
            if _embedding_service is None:
                _embedding_service = EmbeddingService()
    return _embedding_service


def get_model() -> SentenceTransformer:
    """Get the loaded SentenceTransformer model for direct use."""
    return get_embedding_service().model
