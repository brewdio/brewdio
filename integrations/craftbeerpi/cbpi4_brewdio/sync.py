"""Brewdio HTTP client and safe CraftBeerPi recipe synchronization."""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp
import yaml

from .converter import convert_recipe

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    base_url: str
    api_key: str
    kettle_id: str
    sensor_id: str
    sync_interval_seconds: int = 60

    @classmethod
    def load(cls, path: Path) -> "Settings":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            base_url=str(data.get("base_url", "http://127.0.0.1:3000")).rstrip("/"),
            api_key=str(data.get("api_key", "")).strip(),
            kettle_id=str(data.get("kettle_id", "")).strip(),
            sensor_id=str(data.get("sensor_id", "")).strip(),
            sync_interval_seconds=max(15, int(data.get("sync_interval_seconds", 60))),
        )

    def validate(self) -> None:
        if not self.api_key.startswith("brewdio_"):
            raise ValueError("Brewdio API key is missing or invalid")
        if not self.kettle_id or not self.sensor_id:
            raise ValueError("CraftBeerPi kettle and sensor must be configured")


class BrewdioClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def _get(self, path: str) -> Any:
        timeout = aiohttp.ClientTimeout(total=15)
        headers = {"Authorization": f"Bearer {self.settings.api_key}"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(f"{self.settings.base_url}{path}") as response:
                if response.status != 200:
                    message = await response.text()
                    raise RuntimeError(f"Brewdio returned HTTP {response.status}: {message[:200]}")
                return await response.json()

    async def recipes(self) -> list[dict[str, Any]]:
        payload = await self._get("/api/v1/recipes")
        recipes = payload.get("recipes", [])
        if not isinstance(recipes, list):
            raise RuntimeError("Brewdio returned an invalid recipe list")
        return recipes

    async def recipe(self, recipe_id: str) -> dict[str, Any]:
        safe_id = re.sub(r"[^A-Za-z0-9_-]", "", recipe_id)
        if safe_id != recipe_id or not safe_id:
            raise ValueError("invalid Brewdio recipe id")
        payload = await self._get(f"/api/v1/recipes/{safe_id}")
        if not isinstance(payload, dict):
            raise RuntimeError("Brewdio returned an invalid recipe")
        return payload


def _recipe_filename(recipe_id: str) -> str:
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", recipe_id)
    if safe_id != recipe_id or not safe_id:
        raise ValueError("invalid Brewdio recipe id")
    return f"brewdio_{safe_id}.yaml"


def _atomic_yaml_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            yaml.safe_dump(value, handle, allow_unicode=True, sort_keys=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


async def synchronize(settings: Settings, recipes_dir: Path) -> int:
    settings.validate()
    client = BrewdioClient(settings)
    summaries = await client.recipes()
    written = 0
    for summary in summaries:
        recipe_id = str(summary.get("id", ""))
        detail = await client.recipe(recipe_id)
        converted = convert_recipe(detail, settings.kettle_id, settings.sensor_id)
        _atomic_yaml_write(recipes_dir / _recipe_filename(recipe_id), converted)
        written += 1
    logger.info("Synchronized %s Brewdio recipes", written)
    return written
