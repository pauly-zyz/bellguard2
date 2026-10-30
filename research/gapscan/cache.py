"""Small on-disk JSON cache so re-runs don't hammer the public RPC."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable


class Cache:
    def __init__(self, directory: str | Path | None):
        self.dir = Path(directory) if directory else None
        if self.dir:
            self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, namespace: str, key: str) -> Path | None:
        if not self.dir:
            return None
        digest = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self.dir / namespace / f"{digest}.json"

    def get_or_set(self, namespace: str, key: str, fn: Callable[[], Any],
                   *, store: bool = True) -> Any:
        path = self._path(namespace, key)
        if path and path.exists():
            return json.loads(path.read_text())
        value = fn()
        if path and store:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(value))
            tmp.replace(path)
        return value
