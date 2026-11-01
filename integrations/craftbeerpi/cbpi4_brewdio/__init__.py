"""CraftBeerPi 4 integration for Brewdio."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from cbpi.api import CBPiExtension

from .sync import Settings, synchronize

logger = logging.getLogger(__name__)


class BrewdioRecipeSync(CBPiExtension):
    def __init__(self, cbpi):
        self.cbpi = cbpi
        config_dir = Path(self.cbpi.config_folder.get_file_path("."))
        self.settings_path = config_dir / "brewdio.json"
        self.recipes_dir = config_dir / "recipes"
        self._last_error: str | None = None
        self._task = asyncio.create_task(self._run(), name="brewdio_recipe_sync")

    async def _run(self) -> None:
        await asyncio.sleep(5)
        while True:
            interval = 60
            try:
                settings = Settings.load(self.settings_path)
                interval = settings.sync_interval_seconds
                count = await synchronize(settings, self.recipes_dir)
                if self._last_error is not None:
                    logger.info("Brewdio recipe synchronization recovered")
                self._last_error = None
                logger.debug("Brewdio recipe synchronization complete: %s recipes", count)
            except asyncio.CancelledError:
                raise
            except FileNotFoundError:
                self._log_once("Brewdio settings file is missing")
            except Exception as error:
                self._log_once(f"Brewdio synchronization failed: {error}")
            await asyncio.sleep(interval)

    def _log_once(self, message: str) -> None:
        if message != self._last_error:
            logger.warning(message)
            self._last_error = message

    def stop(self):
        if self._task is not None:
            self._task.cancel()


def setup(cbpi):
    cbpi.plugin.register("BrewdioRecipeSync", BrewdioRecipeSync)
