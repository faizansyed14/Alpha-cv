"""Redis Cache Service.

Production-grade Redis caching with fallback to in-memory cache.
Optimized for the CV matching application.
"""

import json
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import redis
from redis.exceptions import ConnectionError, RedisError, TimeoutError

logger = logging.getLogger(__name__)

class RedisCacheService:
    """
    Redis-based cache service with intelligent fallback.
    
    Features:
    - Automatic fallback to in-memory cache if Redis unavailable
    - Compression for large objects
    - TTL support
    - Namespace support for different data types
    - Connection pooling
    - Error handling and recovery
    """
    
    def __init__(
        self,
        host: str = None,
        port: int = None,
        password: str = None,
        username: str = None,
        db: int = 0,
        max_connections: int = 10,
    ):
        """
        Initialize Redis cache service.
        
        Args:
            host: Redis host (defaults to env var or 'redis')
            port: Redis port (defaults to env var or 6379)
            password: Redis password (defaults to env var)
            username: Redis username (defaults to env var)
            db: Redis database number (defaults to 0)
            max_connections: Maximum connections in pool
        """
        # Configuration from centralized settings
        from app.config.settings import settings
        self.host = host or settings.REDIS_HOST
        self.port = port or settings.REDIS_PORT
        self.password = password or settings.REDIS_PASSWORD or None
        self.username = username or settings.REDIS_USERNAME or None
        self.db = db
        self.max_connections = max_connections if max_connections != 10 else settings.REDIS_MAX_CONNECTIONS
        self.socket_timeout = settings.REDIS_SOCKET_TIMEOUT
        
        # Connection state
        self.redis_client = None
        self.is_connected = False
        self.fallback_cache = {}  # In-memory fallback
        self.fallback_ttl = {}
        
        # Statistics
        self.stats = {
            "hits": 0,
            "misses": 0,
            "redis_hits": 0,
            "fallback_hits": 0,
            "errors": 0,
            "fallback_used": False
        }
        
        # Initialize connection
        self._initialize_redis()
        
        logger.info(f"RedisCacheService initialized - Host: {self.host}:{self.port}, DB: {self.db}")
    
    def _initialize_redis(self):
        """Initialize Redis connection with error handling."""
        try:
            # Create Redis connection pool
            connection_kwargs = {
                'host': self.host,
                'port': self.port,
                'db': self.db,
                'max_connections': self.max_connections,
                'socket_connect_timeout': 5,
                'socket_timeout': self.socket_timeout,
                'retry_on_timeout': True,
                'decode_responses': True
            }
            
            # Add authentication if provided
            if self.password:
                connection_kwargs['password'] = self.password
            if self.username:
                connection_kwargs['username'] = self.username
            
            self.redis_client = redis.Redis(**connection_kwargs)
            
            # Test connection
            self.redis_client.ping()
            self.is_connected = True
            logger.info("Redis connection established successfully")
            
        except (ConnectionError, TimeoutError, RedisError) as e:
            logger.warning(f"Redis connection failed: {e}")
            logger.info("Falling back to in-memory cache")
            self.is_connected = False
            self.stats["fallback_used"] = True
    
    # --- coming back after Redis was down -------------------------------------------------------------------------------------------
    # One failed call marks Redis as down, and every call then uses the in-memory fallback at once (no request waits for a dead server).
    # It used to stay down until the process restarted: a Redis restart left presence, the notice, the shared caches and the live
    # events cut off for good. Now, while it is marked down, a background thread pings it at most every RECONNECT_SECONDS and switches
    # back as soon as it answers. The caller never waits for that ping.
    RECONNECT_SECONDS = 15.0

    @property
    def is_connected(self) -> bool:
        connected = self.__dict__.get("_connected", False)
        if not connected:
            self._try_reconnect_soon()
        return connected

    @is_connected.setter
    def is_connected(self, value: bool) -> None:
        if not value and self.__dict__.get("_connected", False):
            self.__dict__["_down_since"] = time.monotonic()       # the first retry waits a moment: it has only just failed
        self.__dict__["_connected"] = bool(value)

    def _try_reconnect_soon(self) -> None:
        client = self.__dict__.get("redis_client")
        if client is None:
            return
        lock = self.__dict__.setdefault("_reconnect_lock", threading.Lock())
        with lock:
            now = time.monotonic()
            last = max(self.__dict__.get("_last_reconnect", 0.0), self.__dict__.get("_down_since", 0.0))
            if self.__dict__.get("_reconnecting") or now - last < self.RECONNECT_SECONDS:
                return
            self.__dict__["_reconnecting"] = True
            self.__dict__["_last_reconnect"] = now

        def ping() -> None:
            try:
                client.ping()
                self.__dict__["_connected"] = True
                logger.info("Redis connection restored")
            except Exception:  # noqa: BLE001 - still down: tried again later
                pass
            finally:
                self.__dict__["_reconnecting"] = False

        threading.Thread(target=ping, name="redis-reconnect", daemon=True).start()

    def _get_namespaced_key(self, namespace: str, key: str) -> str:
        """Create namespaced key for Redis."""
        return f"cv_app:{namespace}:{key}"
    
    def _serialize_value(self, value: Any) -> str:
        """Serialize value for Redis storage."""
        try:
            return json.dumps(value, default=str)
        except (TypeError, ValueError) as e:
            logger.error(f"Serialization failed: {e}")
            return json.dumps(str(value))
    
    def _deserialize_value(self, value: str) -> Any:
        """Deserialize value from Redis."""
        try:
            return json.loads(value)
        except (TypeError, ValueError) as e:
            logger.error(f"Deserialization failed: {e}")
            return value
    
    def set(
        self,
        key: str,
        value: Any,
        ttl_seconds: Optional[int] = None,
        namespace: str = "default",
    ) -> bool:
        """
        Set a value in cache.
        
        Args:
            key: Cache key
            value: Value to cache
            ttl_seconds: Time to live in seconds
            namespace: Namespace for the key
            
        Returns:
            True if successful, False otherwise
        """
        namespaced_key = self._get_namespaced_key(namespace, key)
        serialized_value = self._serialize_value(value)
        
        if self.is_connected:
            try:
                if ttl_seconds:
                    self.redis_client.setex(namespaced_key, ttl_seconds, serialized_value)
                else:
                    self.redis_client.set(namespaced_key, serialized_value)
                return True
            except (ConnectionError, TimeoutError, RedisError) as e:
                logger.warning(f"Redis set failed: {e}")
                self.stats["errors"] += 1
                self.is_connected = False
        
        # Fallback to in-memory cache
        self.fallback_cache[namespaced_key] = serialized_value
        if ttl_seconds:
            self.fallback_ttl[namespaced_key] = time.time() + ttl_seconds
        return True
    
    def get(self, key: str, namespace: str = "default") -> Optional[Any]:
        """
        Get a value from cache.
        
        Args:
            key: Cache key
            namespace: Namespace for the key
            
        Returns:
            Cached value or None if not found
        """
        namespaced_key = self._get_namespaced_key(namespace, key)
        
        if self.is_connected:
            try:
                value = self.redis_client.get(namespaced_key)
                if value is not None:
                    self.stats["hits"] += 1
                    self.stats["redis_hits"] += 1
                    return self._deserialize_value(value)
                else:
                    self.stats["misses"] += 1
                    return None
            except (ConnectionError, TimeoutError, RedisError) as e:
                logger.warning(f"Redis get failed: {e}")
                self.stats["errors"] += 1
                self.is_connected = False
        
        # Fallback to in-memory cache
        if namespaced_key in self.fallback_cache:
            # Check TTL
            if namespaced_key in self.fallback_ttl:
                if time.time() > self.fallback_ttl[namespaced_key]:
                    # Expired
                    del self.fallback_cache[namespaced_key]
                    del self.fallback_ttl[namespaced_key]
                    self.stats["misses"] += 1
                    return None
            
            self.stats["hits"] += 1
            self.stats["fallback_hits"] += 1
            return self._deserialize_value(self.fallback_cache[namespaced_key])
        
        self.stats["misses"] += 1
        return None
    
    def delete(self, key: str, namespace: str = "default") -> bool:
        """Delete a key from cache."""
        namespaced_key = self._get_namespaced_key(namespace, key)
        
        if self.is_connected:
            try:
                self.redis_client.delete(namespaced_key)
            except (ConnectionError, TimeoutError, RedisError) as e:
                logger.warning(f"Redis delete failed: {e}")
                self.stats["errors"] += 1
                self.is_connected = False
        
        # Remove from fallback cache
        self.fallback_cache.pop(namespaced_key, None)
        self.fallback_ttl.pop(namespaced_key, None)
        return True
    
    def clear_namespace(self, namespace: str) -> bool:
        """Clear all keys in a namespace."""
        pattern = self._get_namespaced_key(namespace, "*")
        
        if self.is_connected:
            try:
                keys = self.redis_client.keys(pattern)
                if keys:
                    self.redis_client.delete(*keys)
                return True
            except (ConnectionError, TimeoutError, RedisError) as e:
                logger.warning(f"Redis clear namespace failed: {e}")
                self.stats["errors"] += 1
                self.is_connected = False
        
        # Clear from fallback cache
        keys_to_remove = [k for k in self.fallback_cache.keys() if k.startswith(f"cv_app:{namespace}:")]
        for key in keys_to_remove:
            self.fallback_cache.pop(key, None)
            self.fallback_ttl.pop(key, None)
        
        return True
    
    def entries(self, namespace: str) -> List[Tuple[str, Any, Optional[int]]]:
        """Every ``(key, value, seconds_left)`` in a namespace (``seconds_left`` None = no expiry). A scan for admin screens, never for
        a request path."""
        prefix = self._get_namespaced_key(namespace, "")
        found: List[Tuple[str, Any, Optional[int]]] = []
        if self.is_connected:
            try:
                for full in self.redis_client.scan_iter(match=prefix + "*", count=200):
                    raw = self.redis_client.get(full)
                    if raw is None:
                        continue                                  # expired between the scan and the read
                    ttl = self.redis_client.ttl(full)
                    found.append((full[len(prefix):], self._deserialize_value(raw), ttl if ttl and ttl > 0 else None))
                return found
            except (ConnectionError, TimeoutError, RedisError) as e:
                logger.warning(f"Redis scan failed: {e}")
                self.stats["errors"] += 1
                self.is_connected = False
                found = []

        now = time.time()
        for full, raw in list(self.fallback_cache.items()):
            if not full.startswith(prefix):
                continue
            expires = self.fallback_ttl.get(full)
            if expires is not None and now > expires:
                continue
            found.append((full[len(prefix):], self._deserialize_value(raw), int(expires - now) if expires is not None else None))
        return found

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        stats = self.stats.copy()
        
        if self.is_connected:
            try:
                info = self.redis_client.info("memory")
                stats.update({
                    "redis_memory_used": info.get("used_memory_human", "unknown"),
                    "redis_memory_peak": info.get("used_memory_peak_human", "unknown"),
                    "redis_connected_clients": info.get("connected_clients", 0),
                    "redis_uptime": info.get("uptime_in_seconds", 0)
                })
            except (ConnectionError, TimeoutError, RedisError):
                pass
        
        stats.update({
            "fallback_cache_size": len(self.fallback_cache),
            "is_connected": self.is_connected,
            "hit_rate": self.stats["hits"] / max(1, self.stats["hits"] + self.stats["misses"])
        })
        
        return stats
    
    def health_check(self) -> Dict[str, Any]:
        """Check Redis health."""
        if self.is_connected:
            try:
                self.redis_client.ping()
                return {
                    "status": "healthy",
                    "type": "redis",
                    "host": self.host,
                    "port": self.port,
                    "db": self.db
                }
            except (ConnectionError, TimeoutError, RedisError) as e:
                return {
                    "status": "unhealthy",
                    "type": "redis",
                    "error": str(e),
                    "fallback_active": True
                }
        else:
            return {
                "status": "degraded",
                "type": "fallback",
                "fallback_cache_size": len(self.fallback_cache),
                "message": "Using in-memory fallback cache"
            }

# Global Redis cache instance
_redis_cache: Optional[RedisCacheService] = None

def get_redis_cache() -> RedisCacheService:
    """Get the global Redis cache instance."""
    global _redis_cache
    if _redis_cache is None:
        _redis_cache = RedisCacheService()
    return _redis_cache
