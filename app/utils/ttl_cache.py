"""Small in-process TTL cache for rarely-changing reference data (single-worker safe)."""
from __future__ import annotations

import time
from typing import Callable, TypeVar

T = TypeVar("T")


class TtlCache:
    def __init__(self) -> None:
        self._entries: dict[str, tuple[float, object]] = {}

    def get_or_set(self, key: str, ttl_seconds: float, factory: Callable[[], T]) -> T:
        now = time.monotonic()
        hit = self._entries.get(key)
        if hit is not None and hit[0] > now:
            return hit[1]  # type: ignore[return-value]
        value = factory()
        self._entries[key] = (now + ttl_seconds, value)
        return value

    def invalidate(self, key: str) -> None:
        self._entries.pop(key, None)

    def clear(self) -> None:
        self._entries.clear()


reference_cache = TtlCache()
