"""Store the Brewdio API key without echoing it or adding it to shell history."""

from __future__ import annotations

import getpass
import json
import os
import sys
import tempfile
from pathlib import Path


DEFAULT_PATH = Path("/home/anders/craftbeerpi/config/brewdio.json")


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        print(f"Kunne ikke lese {path}: {error}")
        return 1

    api_key = getpass.getpass("Lim inn Brewdio API-nøkkelen (skjult): ").strip()
    if not api_key.startswith("brewdio_") or len(api_key) < 20:
        print("Nøkkelen ser ikke ut som en gyldig Brewdio API-nøkkel.")
        return 1

    settings["api_key"] = api_key
    fd, temp_name = tempfile.mkstemp(prefix=".brewdio.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(settings, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
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

    print("API-nøkkelen er lagret sikkert. Start CraftBeerPi på nytt for å aktivere pluginen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
