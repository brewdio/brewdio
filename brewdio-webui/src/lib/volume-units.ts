import type { SettingsDocument } from "@/lib/db/settings";

export type DisplayVolumeUnit = SettingsDocument["defaultVolumeUnit"];

const unitsPerGallon: Record<DisplayVolumeUnit, number> = {
  ml: 3785.411784,
  l: 3.785411784,
  tsp: 768,
  tbsp: 256,
  floz: 128,
  cup: 16,
  pt: 8,
  qt: 4,
  gal: 1,
  bbl: 1 / 31,
};

export function gallonsToUnit(
  gallons: number,
  unit: DisplayVolumeUnit
): number {
  return gallons * unitsPerGallon[unit];
}

export function unitToGallons(
  value: number,
  unit: DisplayVolumeUnit
): number {
  return value / unitsPerGallon[unit];
}
