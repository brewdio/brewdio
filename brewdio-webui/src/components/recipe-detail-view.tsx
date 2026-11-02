import { AddFermentableDialog } from "@/components/add-fermentable-dialog";
import { AddHopDialog } from "@/components/add-hop-dialog";
import { AddCultureDialog } from "@/components/add-culture-dialog";
import { InlineEditableWithUnit } from "@/components/inline-editable";
import { EditableNotes } from "@/components/editable-notes";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useCalculation } from "@/hooks/use-calculation";
import { useCommandHandler } from "@/hooks/use-command";
import { RetroCockpitDial } from "@/components/retro-cockpit-dial";
import { GravitySightGlass } from "@/components/gravity-sight-glass";
import { Screw } from "@/components/screw";
import { srmToSrgb, rgbToHex, colorToSrm, styleForRecipe, calculateWater } from "brewdio-wasm";
import { GrainIcon, HopIcon, YeastIcon } from "@/components/ingredient-icons";
import type { FermentableAdditionType, RecipeType, EquipmentType, VolumeUnitType, TimeUnitType, WaterCalculatorResult } from "brewdio-wasm";
import { useTranslation } from "react-i18next";

/**
 * Get hex color for a fermentable based on its SRM value
 */
export function getFermentableColorHex(fermentable: FermentableAdditionType): string | undefined {
  const colorData = fermentable.color;

  if (!colorData) {
    return undefined;
  }

  try {
    const srm = colorToSrm(colorData);
    const rgb = srmToSrgb(srm) as [number, number, number];
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  } catch {
    return undefined;
  }
}

interface RecipeDetailViewProps {
  recipe: RecipeType;
  equipment?: EquipmentType;
  updateRecipe: (mutateFn: (r: RecipeType) => void) => void;
  headerSlot: React.ReactNode;
  alertSlot?: React.ReactNode;
  notesLabel?: string;
  notesPlaceholder?: string;
}

export function RecipeDetailView({
  recipe: beerRecipe,
  equipment,
  updateRecipe,
  headerSlot,
  alertSlot,
  notesLabel,
  notesPlaceholder,
}: RecipeDetailViewProps) {
  const { t } = useTranslation();
  const og = useCalculation<number>("og");
  const fg = useCalculation<number>("fg");
  const abv = useCalculation<number>("abv");
  const color = useCalculation<number>("color");
  const ibu = useCalculation<number>("ibu");

  // Command-controlled dialog state
  const [fermentableDialogOpen, setFermentableDialogOpen] = useState(false);
  const [hopDialogOpen, setHopDialogOpen] = useState(false);
  const [cultureDialogOpen, setCultureDialogOpen] = useState(false);

  // Register command handlers for ingredient dialogs and section scrolling
  useCommandHandler(
    "recipe.addFermentable",
    useCallback(() => setFermentableDialogOpen(true), [])
  );
  useCommandHandler(
    "recipe.addHop",
    useCallback(() => setHopDialogOpen(true), [])
  );
  useCommandHandler(
    "recipe.addCulture",
    useCallback(() => setCultureDialogOpen(true), [])
  );
  useCommandHandler(
    "recipe.scrollFermentables",
    useCallback(
      () => document.getElementById("fermentables")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      []
    )
  );
  useCommandHandler(
    "recipe.scrollHops",
    useCallback(
      () => document.getElementById("hops")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      []
    )
  );
  useCommandHandler(
    "recipe.scrollCultures",
    useCallback(
      () => document.getElementById("cultures")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      []
    )
  );
  useCommandHandler(
    "recipe.scrollNotes",
    useCallback(
      () => document.querySelector("[data-notes]")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      []
    )
  );

  const styleRanges = useMemo(() => {
    if (!beerRecipe) return null;

    const style = styleForRecipe(beerRecipe);
    if (!style) return null;

    const getRange = (range: any) => {
      if (!range) return null;
      return {
        min: range.minimum?.value ?? null,
        max: range.maximum?.value ?? null,
      };
    };

    return {
      og: getRange(style.original_gravity),
      fg: getRange(style.final_gravity),
      ibu: getRange(style.international_bitterness_units),
      color: getRange(style.color),
      abv: getRange(style.alcohol_by_volume),
    };
  }, [beerRecipe]);

  // Calculate pre-boil size from the water calculator
  const calculatedBoilSize = useMemo(() => {
    const volUnit = beerRecipe.batch_size.unit;
    const input = {
      target_batch_size: beerRecipe.batch_size,
      boil_time: beerRecipe.boil?.boil_time ?? { value: 60, unit: "min" },
      grain_bill: beerRecipe.ingredients?.fermentable_additions ?? [],
      mash_steps: beerRecipe.mash?.mash_steps ?? [],
      grain_temperature: { value: 20, unit: "C" },
      equipment: equipment ?? null,
      units: { volume_unit: volUnit, temperature_unit: volUnit === "gal" ? "F" : "C" },
    };
    const result = calculateWater(input as any) as WaterCalculatorResult;
    const boilStage = result.calculatedStages.find(
      (s) => s.stageType === "boil"
    );
    if (!boilStage) return null;
    return { value: boilStage.volumeIn, unit: volUnit };
  }, [beerRecipe, equipment]);

  const handleRemoveFermentable = (index: number) => {
    updateRecipe((r) => {
      r.ingredients.fermentable_additions =
        r.ingredients.fermentable_additions?.filter((_, idx) => idx !== index) || [];
    });
  };

  const handleRemoveHop = (index: number) => {
    updateRecipe((r) => {
      r.ingredients.hop_additions =
        r.ingredients.hop_additions?.filter((_, idx) => idx !== index) || [];
    });
  };

  const handleRemoveCulture = (index: number) => {
    updateRecipe((r) => {
      r.ingredients.culture_additions =
        r.ingredients.culture_additions?.filter((_, idx) => idx !== index) || [];
    });
  };

  const handleBatchSizeUpdate = (newValue: number, newUnit: string) => {
    updateRecipe((r) => {
      r.batch_size = { value: newValue, unit: newUnit as VolumeUnitType };
    });
  };

  const handleBoilTimeUpdate = (newValue: number, newUnit: string) => {
    updateRecipe((r) => {
      if (!r.boil) r.boil = { boil_time: { value: 60, unit: "min" } };
      r.boil.boil_time = { value: newValue, unit: newUnit as TimeUnitType };
    });
  };

  const handleEfficiencyUpdate = (newValue: number, _unit: string) => {
    updateRecipe((r) => {
      if (!r.efficiency) {
        r.efficiency = {
          brewhouse: { value: newValue, unit: "%" },
          conversion: { value: 100, unit: "%" },
          lauter: { value: 95, unit: "%" },
          mash: { value: 95, unit: "%" },
        };
      } else {
        r.efficiency.brewhouse = { value: newValue, unit: "%" };
      }
    });
  };

  const handleNotesUpdate = (newNotes: string) => {
    updateRecipe((r) => {
      r.notes = newNotes;
    });
  };

  const liquidColor = color
    ? (() => {
        const rgb = srmToSrgb(color) as [number, number, number];
        return rgbToHex(rgb[0], rgb[1], rgb[2]);
      })()
    : "#FBB123";

  return (
    <div className="flex flex-col gap-6">
      {headerSlot}

      {alertSlot}

      {/* Calculated Values Section - Retro Cockpit Panel */}
      <div className="relative bg-gray-100 dark:bg-gray-900 border-t-2 border-gray-300 dark:border-gray-700 rounded-xl p-4 shadow-xl overflow-hidden">
        {/* Subtle texture overlay */}
        <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/brushed-alum-dark.png')]"></div>

        {/* Panel Mounting Screws */}
        <Screw tl />
        <Screw tr />
        <Screw bl />
        <Screw br />

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 relative z-10 p-2">
          {/* LEFT COLUMN: GRAVITY SECTION */}
          <div className="md:col-span-3 flex justify-around bg-white/50 dark:bg-gray-950/30 p-3 rounded-lg border border-gray-300 dark:border-gray-800">
            <GravitySightGlass
              label="OG"
              value={og ?? 1.0}
              liquidColor={liquidColor}
              percentage={0}
              min={1.0}
              max={1.1}
              targetMin={styleRanges?.og?.min ?? 1.04}
              targetMax={styleRanges?.og?.max ?? 1.07}
            />
            {/* Arrow indicating change */}
            <div className="self-center text-gray-600 dark:text-gray-500 text-2xl">
              →
            </div>
            <GravitySightGlass
              label="FG"
              value={fg ?? 1.0}
              liquidColor={liquidColor}
              percentage={0}
              min={1.0}
              max={1.04}
              targetMin={styleRanges?.fg?.min ?? 1.008}
              targetMax={styleRanges?.fg?.max ?? 1.016}
            />
          </div>

          {/* RIGHT COLUMN: DIALS SECTION */}
          <div className="md:col-span-9 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* IBU DIAL */}
            <div className="bg-white/50 dark:bg-gray-950/30 p-2 rounded-lg border border-gray-300 dark:border-gray-800 flex items-center justify-center">
              <RetroCockpitDial
                label="IBU"
                value={ibu ?? 0}
                min={0}
                max={100}
                targetMin={styleRanges?.ibu?.min ?? 20}
                targetMax={styleRanges?.ibu?.max ?? 60}
              />
            </div>

            {/* COLOUR DIAL */}
            <div className="bg-white/50 dark:bg-gray-950/30 p-2 rounded-lg border border-gray-300 dark:border-gray-800 flex items-center justify-center">
              <RetroCockpitDial
                label="SRM"
                value={color !== undefined ? color : 0}
                min={0}
                max={40}
                targetMin={styleRanges?.color ? styleRanges.color.min : 4}
                targetMax={styleRanges?.color ? styleRanges.color.max : 20}
                showSrmGradient={true}
              />
            </div>

            {/* ABV DIAL */}
            <div className="bg-white/50 dark:bg-gray-950/30 p-2 rounded-lg border border-gray-300 dark:border-gray-800 flex items-center justify-center">
              <RetroCockpitDial
                label="ABV"
                value={abv ?? 0}
                min={0}
                max={12}
                targetMin={styleRanges?.abv?.min ?? 4}
                targetMax={styleRanges?.abv?.max ?? 7}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">{t("recipes.detailsTitle")}</h2>
          <div className="grid grid-cols-[1fr_auto] gap-y-1 gap-x-4 items-center">
            <InlineEditableWithUnit
              value={beerRecipe.batch_size.value}
              unit={beerRecipe.batch_size.unit}
              availableUnits={["gal", "l", "ml"]}
              onSave={handleBatchSizeUpdate}
              label={t("recipes.batchSizeLabel")}
            />
            {calculatedBoilSize && (
              <>
                <span className="font-medium text-sm py-1">{t("recipes.boilSizeLabel")}</span>
                <span className="text-sm">
                  <span className="font-semibold">{calculatedBoilSize.value.toFixed(2)}</span>{" "}
                  <span className="text-muted-foreground">{calculatedBoilSize.unit}</span>
                </span>
              </>
            )}
            {beerRecipe.boil?.boil_time && (
              <InlineEditableWithUnit
                value={beerRecipe.boil.boil_time.value}
                unit={beerRecipe.boil.boil_time.unit}
                availableUnits={["min", "hr"]}
                onSave={handleBoilTimeUpdate}
                label={t("recipes.boilTimeLabel")}
              />
            )}
            {beerRecipe.efficiency && (
              <InlineEditableWithUnit
                value={beerRecipe.efficiency.brewhouse.value}
                unit="%"
                availableUnits={["%"]}
                onSave={handleEfficiencyUpdate}
                label={t("recipes.brewhouseEfficiencyLabel")}
              />
            )}
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">{notesLabel ?? t("recipes.notesLabel")}</h2>
          <EditableNotes
            value={beerRecipe.notes || ""}
            onSave={handleNotesUpdate}
            placeholder={notesPlaceholder ?? t("recipes.notesPlaceholder")}
          />
        </div>
      </div>

      {/* Command-controlled dialogs (no trigger, opened via keyboard shortcuts) */}
      <AddFermentableDialog open={fermentableDialogOpen} onOpenChange={setFermentableDialogOpen} />
      <AddHopDialog open={hopDialogOpen} onOpenChange={setHopDialogOpen} />
      <AddCultureDialog open={cultureDialogOpen} onOpenChange={setCultureDialogOpen} />

      <div id="fermentables" className="border rounded-lg p-4 scroll-mt-20">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">{t("recipes.fermentables")}</h2>
          <AddFermentableDialog />
        </div>
        {beerRecipe.ingredients.fermentable_additions?.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {t("recipes.noFermentables")}
          </div>
        ) : (
          <div className="space-y-2">
            {beerRecipe.ingredients.fermentable_additions?.map((ferm, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center text-sm border-b pb-2 last:border-0"
              >
                <div className="flex items-center gap-1.5">
                  <GrainIcon
                    className="h-6 w-6 flex-shrink-0"
                    srmColor={getFermentableColorHex(ferm)}
                  />
                  <span className="font-medium">
                    {ferm.name || t("recipes.unnamedFermentable")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {ferm.amount.value} {ferm.amount.unit}
                  </span>
                  <AddFermentableDialog
                    existingFermentable={ferm}
                    index={idx}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveFermentable(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="hops" className="border rounded-lg p-4 scroll-mt-20">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">{t("recipes.hops")}</h2>
          <AddHopDialog />
        </div>
        {beerRecipe.ingredients.hop_additions?.length === 0 ? (
          <div className="text-muted-foreground text-sm">{t("recipes.noHops")}</div>
        ) : (
          <div className="space-y-2">
            {beerRecipe.ingredients.hop_additions?.map((hop, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center text-sm border-b pb-2 last:border-0"
              >
                <div className="flex items-center gap-1.5">
                  <HopIcon className="h-6 w-6 flex-shrink-0" />
                  <div>
                    <span className="font-medium">
                      {hop.name || t("recipes.unnamedHop")}
                    </span>
                    {hop.timing && (
                      <span className="text-muted-foreground ml-2">
                        {hop.timing.use === "add_to_boil" && t("recipes.hopBoil")}
                        {hop.timing.use === "add_to_fermentation" && t("recipes.dryHop")}
                        {hop.timing.time && (
                          <>
                            {" "}
                            @ {hop.timing.time.value} {hop.timing.time.unit}
                          </>
                        )}
                        {hop.timing.duration && (
                          <>
                            {" "}
                            ({hop.timing.duration.value} {hop.timing.duration.unit})
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {hop.amount.value} {hop.amount.unit}
                  </span>
                  <AddHopDialog
                    existingHop={hop}
                    index={idx}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveHop(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div id="cultures" className="border rounded-lg p-4 scroll-mt-20">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">{t("recipes.cultures")}</h2>
          <AddCultureDialog />
        </div>
        {beerRecipe.ingredients.culture_additions?.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            {t("recipes.noCultures")}
          </div>
        ) : (
          <div className="space-y-2">
            {beerRecipe.ingredients.culture_additions?.map((culture, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center text-sm border-b pb-2 last:border-0"
              >
                <div className="flex items-center gap-1.5">
                  <YeastIcon className="h-6 w-6 flex-shrink-0" />
                  <span className="font-medium">
                    {culture.name || t("recipes.unnamedCulture")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {culture.amount && (
                    <span className="text-muted-foreground">
                      {culture.amount.value} {culture.amount.unit}
                    </span>
                  )}
                  <AddCultureDialog
                    existingCulture={culture}
                    index={idx}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveCulture(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
