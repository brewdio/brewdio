"""Convert Brewdio BeerJSON recipes to CraftBeerPi recipe files."""

from __future__ import annotations

from typing import Any


def _pick(value: dict[str, Any] | None, *names: str, default: Any = None) -> Any:
    if not isinstance(value, dict):
        return default
    for name in names:
        if name in value:
            return value[name]
    return default


def _measurement(value: Any) -> tuple[float, str]:
    if not isinstance(value, dict):
        raise ValueError("measurement must be an object")
    return float(value["value"]), str(value.get("unit", "")).lower()


def temperature_celsius(value: Any) -> float:
    number, unit = _measurement(value)
    if unit in {"c", "°c", "celsius"}:
        return number
    if unit in {"f", "°f", "fahrenheit"}:
        return (number - 32.0) * 5.0 / 9.0
    if unit in {"k", "kelvin"}:
        return number - 273.15
    raise ValueError(f"unsupported temperature unit: {unit}")


def duration_minutes(value: Any) -> float:
    number, unit = _measurement(value)
    if unit in {"min", "minute", "minutes"}:
        return number
    if unit in {"s", "sec", "second", "seconds"}:
        return number / 60.0
    if unit in {"h", "hr", "hour", "hours"}:
        return number * 60.0
    raise ValueError(f"unsupported duration unit: {unit}")


def _number(value: float) -> str:
    rounded = round(value, 2)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def _amount_text(amount: Any) -> str:
    if not isinstance(amount, dict) or "value" not in amount:
        return ""
    value = _number(float(amount["value"]))
    unit = str(amount.get("unit", "")).strip()
    return f"{value} {unit}".strip()


def _mash_steps(recipe: dict[str, Any], kettle_id: str, sensor_id: str) -> list[dict[str, Any]]:
    mash = _pick(recipe, "mash", default={})
    source_steps = _pick(mash, "mash_steps", "mashSteps", default=[])
    result: list[dict[str, Any]] = []
    for index, source in enumerate(source_steps or [], start=1):
        try:
            temp = temperature_celsius(
                _pick(source, "step_temperature", "stepTemperature")
            )
            timer = duration_minutes(_pick(source, "step_time", "stepTime"))
        except (KeyError, TypeError, ValueError):
            continue
        result.append(
            {
                "name": str(source.get("name") or f"Mesking {index}"),
                "type": "MashStep",
                "props": {
                    "Timer": _number(timer),
                    "Temp": _number(temp),
                    "Sensor": sensor_id,
                    "Kettle": kettle_id,
                    "AutoMode": "Yes",
                },
            }
        )
    return result


def _boil_step(recipe: dict[str, Any], kettle_id: str, sensor_id: str) -> dict[str, Any] | None:
    boil = _pick(recipe, "boil", default={})
    boil_time = _pick(boil, "boil_time", "boilTime")
    if boil_time is None:
        return None
    try:
        timer = duration_minutes(boil_time)
    except (KeyError, TypeError, ValueError):
        return None

    props: dict[str, str] = {
        "Timer": _number(timer),
        "Temp": "100",
        "Sensor": sensor_id,
        "Kettle": kettle_id,
        "LidAlert": "Yes",
        "AutoMode": "Yes",
        "First_Wort": "No",
    }
    ingredients = _pick(recipe, "ingredients", default={})
    hops = _pick(ingredients, "hop_additions", "hopAdditions", default=[])
    timed_hops: list[tuple[float, dict[str, Any]]] = []
    for hop in hops or []:
        timing = _pick(hop, "timing", default={})
        use = str(_pick(timing, "use", default="")).lower()
        if use not in {"add_to_boil", "boil"}:
            continue
        try:
            minutes = duration_minutes(_pick(timing, "time"))
        except (KeyError, TypeError, ValueError):
            continue
        timed_hops.append((minutes, hop))

    for index, (minutes, hop) in enumerate(
        sorted(timed_hops, key=lambda item: item[0], reverse=True)[:6], start=1
    ):
        amount = _amount_text(_pick(hop, "amount"))
        name = str(_pick(hop, "name", default=f"Humle {index}"))
        label = f"{name} – {amount}" if amount else name
        props[f"Hop_{index}"] = _number(minutes)
        props[f"Hop_{index}_text"] = label

    return {"name": "Koking", "type": "BoilStep", "props": props}


def convert_recipe(detail: dict[str, Any], kettle_id: str, sensor_id: str) -> dict[str, Any]:
    recipe = _pick(detail, "recipe", default=detail)
    recipe_id = str(_pick(detail, "id", default=""))
    name = str(_pick(recipe, "name", default=_pick(detail, "name", default="Oppskrift")))
    author = str(_pick(recipe, "author", default="Brewdio"))

    steps = _mash_steps(recipe, kettle_id, sensor_id)
    boil = _boil_step(recipe, kettle_id, sensor_id)
    if boil is not None:
        steps.append(boil)

    return {
        "basic": {
            "name": f"Brewdio – {name}",
            "author": author,
            "brewdio_recipe_id": recipe_id,
        },
        "steps": steps,
    }
