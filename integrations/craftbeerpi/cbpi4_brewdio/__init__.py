"""CraftBeerPi 4 integration for Brewdio."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from cbpi.api import CBPiExtension, CBPiStep, Property, parameters
from cbpi.api.dataclasses import NotificationType

from .sync import BrewdioClient, Settings, synchronize

logger = logging.getLogger(__name__)


@parameters([Property.Text(label="RecipeId", configurable=False)])
class BrewdioStartBatchStep(CBPiStep):
    async def run(self):
        recipe_id = str(self.props.get("RecipeId", "")).strip()
        settings_path = Path(self.cbpi.config_folder.get_file_path("brewdio.json"))
        try:
            settings = Settings.load(settings_path)
            settings.validate()
            response = await BrewdioClient(settings).start_batch(
                recipe_id,
                f"craftbeerpi:{self.id}",
            )
        except Exception as error:
            logger.error("Brewdio batch start failed: %s", error)
            self.summary = "Kunne ikke opprette Brewdio-brygg"
            self.cbpi.notify(
                "Brewdio",
                "Brygget ble ikke opprettet. Lageret er ikke endret. Kontroller tilkoblingen og prøv trinnet igjen.",
                NotificationType.ERROR,
            )
            await self.push_update()
            while self.running:
                await asyncio.sleep(1)
            return

        batch_name = str(response.get("batchName", "Brewdio-brygg"))
        deductions = int(response.get("inventoryDeductionCount", 0))
        shortages = int(response.get("inventoryShortageCount", 0))
        self.summary = f"{batch_name} – {deductions} lageruttak"
        message = f"{batch_name} er opprettet med {deductions} lageruttak."
        if shortages:
            message += f" {shortages} ingrediensbehov manglet på lager."
        self.cbpi.notify("Brewdio", message, NotificationType.SUCCESS)
        await self.push_update()
        await self.next()


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
    cbpi.plugin.register("BrewdioStartBatchStep", BrewdioStartBatchStep)
    cbpi.plugin.register("BrewdioRecipeSync", BrewdioRecipeSync)
