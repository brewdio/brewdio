import type {
  InventoryItem,
  InventoryQuantity,
  InventoryShortage,
  MassType,
  RecipeType,
  UnitType,
  VolumeType,
} from "brewdio-wasm";
import type { InventoryDeductionPlan } from "@/lib/db/backend";

export interface InventoryPlanLine {
  key: string;
  ingredientName: string;
  required: InventoryQuantity;
  allocated: InventoryQuantity;
  missing: InventoryQuantity;
}

export interface BuiltInventoryPlan {
  plan: InventoryDeductionPlan;
  lines: InventoryPlanLine[];
  hasShortages: boolean;
}

const MASS_FACTORS: Record<MassType["unit"], number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  lb: 453.592,
  oz: 28.3495,
};

const VOLUME_FACTORS: Record<VolumeType["unit"], number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892,
  tbsp: 14.7868,
  floz: 29.5735,
  cup: 236.588,
  pt: 473.176,
  qt: 946.353,
  gal: 3785.41,
  bbl: 117347.77,
  ifloz: 28.4131,
  ipt: 568.261,
  iqt: 1136.52,
  igal: 4546.09,
  ibbl: 163659.24,
};

const EPSILON = 0.000_001;

function quantityToBase(quantity: InventoryQuantity) {
  switch (quantity.kind) {
    case "mass":
      return quantity.data.value * MASS_FACTORS[quantity.data.unit];
    case "volume":
      return quantity.data.value * VOLUME_FACTORS[quantity.data.unit];
    case "unit":
      return quantity.data.value;
  }
}

function quantityFromBase(template: InventoryQuantity, value: number): InventoryQuantity {
  if (template.kind === "mass") {
    return {
      kind: "mass",
      data: {
        unit: template.data.unit,
        value: value / MASS_FACTORS[template.data.unit],
      },
    };
  }
  if (template.kind === "unit") {
    return {
      kind: "unit",
      data: { unit: template.data.unit, value },
    };
  }
  return {
    kind: "volume",
    data: {
      unit: template.data.unit,
      value: value / VOLUME_FACTORS[template.data.unit],
    },
  };
}

function compatibleQuantities(left: InventoryQuantity, right: InventoryQuantity) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "mass") return true;
  if (left.kind === "volume") return true;
  return left.data.unit === right.data.unit;
}

const MASS_UNITS = new Set(["mg", "g", "kg", "lb", "oz"]);
const VOLUME_UNITS = new Set([
  "ml", "l", "tsp", "tbsp", "floz", "cup", "pt", "qt", "gal", "bbl",
  "ifloz", "ipt", "iqt", "igal", "ibbl",
]);

function inventoryQuantityForAmount(
  amount: MassType | VolumeType | UnitType
): InventoryQuantity {
  if (MASS_UNITS.has(amount.unit)) {
    return { kind: "mass", data: { ...amount } as MassType };
  }
  if (VOLUME_UNITS.has(amount.unit)) {
    return { kind: "volume", data: { ...amount } as VolumeType };
  }
  return { kind: "unit", data: { ...amount } as UnitType };
}

interface Requirement {
  ingredientKind: InventoryItem["ingredient"]["kind"];
  ingredientName: string;
  quantity: InventoryQuantity;
}

function recipeRequirements(recipe: RecipeType): Requirement[] {
  return [
    ...(recipe.ingredients.fermentable_additions ?? []).map((addition) => ({
      ingredientKind: "fermentable" as const,
      ingredientName: addition.name,
      quantity: inventoryQuantityForAmount(addition.amount),
    })),
    ...(recipe.ingredients.hop_additions ?? []).map((addition) => ({
      ingredientKind: "hop" as const,
      ingredientName: addition.name,
      quantity: inventoryQuantityForAmount(addition.amount),
    })),
    ...(recipe.ingredients.culture_additions ?? [])
      .filter((addition) => addition.amount !== undefined)
      .map((addition) => ({
        ingredientKind: "culture" as const,
        ingredientName: addition.name,
        quantity: inventoryQuantityForAmount(addition.amount!),
      })),
  ];
}

function groupedRequirements(recipe: RecipeType) {
  const grouped = new Map<string, Requirement>();
  for (const requirement of recipeRequirements(recipe)) {
    const unit = String(requirement.quantity.data.unit);
    const key = `${requirement.ingredientKind}:${requirement.ingredientName.toLocaleLowerCase()}:${requirement.quantity.kind}:${unit}`;
    const existing = grouped.get(key);
    if (existing) {
      const total = quantityToBase(existing.quantity) + quantityToBase(requirement.quantity);
      existing.quantity = quantityFromBase(existing.quantity, total);
    } else {
      grouped.set(key, requirement);
    }
  }
  return [...grouped.entries()];
}

export function buildInventoryDeductionPlan(
  recipe: RecipeType,
  inventoryItems: InventoryItem[],
  updatedAt = new Date().toISOString()
): BuiltInventoryPlan {
  const remainingByItem = new Map(
    inventoryItems.map((item) => [item.id, quantityToBase(item.quantity)])
  );
  const deductions: InventoryDeductionPlan["deductions"] = [];
  const shortages: InventoryShortage[] = [];
  const lines: InventoryPlanLine[] = [];

  for (const [key, requirement] of groupedRequirements(recipe)) {
    const requiredBase = quantityToBase(requirement.quantity);
    let missingBase = requiredBase;
    const candidates = inventoryItems
      .filter(
        (item) =>
          item.ingredient.kind === requirement.ingredientKind &&
          item.ingredient.data.name.toLocaleLowerCase() ===
            requirement.ingredientName.toLocaleLowerCase() &&
          compatibleQuantities(item.quantity, requirement.quantity)
      )
      .sort((left, right) => {
        const leftDate = left.bestBefore ?? "9999-12-31";
        const rightDate = right.bestBefore ?? "9999-12-31";
        return leftDate.localeCompare(rightDate) || left.createdAt.localeCompare(right.createdAt);
      });

    for (const item of candidates) {
      if (missingBase <= EPSILON) break;
      const availableBase = remainingByItem.get(item.id) ?? 0;
      const deductionBase = Math.min(availableBase, missingBase);
      if (deductionBase <= EPSILON) continue;
      deductions.push({
        inventoryItemId: item.id,
        quantity: quantityFromBase(item.quantity, deductionBase),
      });
      remainingByItem.set(item.id, availableBase - deductionBase);
      missingBase -= deductionBase;
    }

    const normalizedMissing = missingBase <= EPSILON ? 0 : missingBase;
    const missing = quantityFromBase(requirement.quantity, normalizedMissing);
    const allocated = quantityFromBase(
      requirement.quantity,
      requiredBase - normalizedMissing
    );
    lines.push({
      key,
      ingredientName: requirement.ingredientName,
      required: requirement.quantity,
      allocated,
      missing,
    });
    if (normalizedMissing > 0) {
      shortages.push({
        ingredientName: requirement.ingredientName,
        required: requirement.quantity,
        missing,
      });
    }
  }

  return {
    plan: { deductions, shortages, updatedAt },
    lines,
    hasShortages: shortages.length > 0,
  };
}

export function emptyInventoryDeductionPlan(
  updatedAt = new Date().toISOString()
): InventoryDeductionPlan {
  return { deductions: [], shortages: [], updatedAt };
}
