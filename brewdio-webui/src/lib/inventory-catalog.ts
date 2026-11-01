import type {
  CultureInformation,
  FermentableType,
  HopVarietyBase,
  InventoryIngredient,
  InventoryItem,
  InventoryQuantity,
} from "brewdio-wasm";

export type InventoryIngredientKind = InventoryIngredient["kind"];

type IngredientForKind<K extends InventoryIngredientKind> = Extract<
  InventoryIngredient,
  { kind: K }
>["data"];

export interface IngredientCatalogEntry<T> {
  key: string;
  ingredient: T;
  stock: string | null;
}

const ingredientKey = (name: string) => name.trim().toLocaleLowerCase();

function formatStock(quantities: InventoryQuantity[]) {
  const totals = new Map<string, { value: number; unit: string }>();

  for (const quantity of quantities) {
    const unit = String(quantity.data.unit);
    const groupKey = `${quantity.kind}:${unit}`;
    const current = totals.get(groupKey);
    if (current) {
      current.value += quantity.data.value;
    } else {
      totals.set(groupKey, { value: quantity.data.value, unit });
    }
  }

  return [...totals.values()]
    .map(({ value, unit }) => `${value.toLocaleString()} ${unit}`)
    .join(" + ");
}

export function buildIngredientCatalog<K extends InventoryIngredientKind>(
  builtInIngredients: IngredientForKind<K>[],
  inventoryItems: InventoryItem[],
  kind: K
): IngredientCatalogEntry<IngredientForKind<K>>[] {
  const entries = new Map<
    string,
    {
      ingredient: IngredientForKind<K>;
      quantities: InventoryQuantity[];
    }
  >();

  for (const ingredient of builtInIngredients) {
    entries.set(ingredientKey(ingredient.name), {
      ingredient,
      quantities: [],
    });
  }

  for (const item of inventoryItems) {
    if (item.ingredient.kind !== kind) continue;
    const ingredient = item.ingredient.data as IngredientForKind<K>;
    const key = ingredientKey(ingredient.name);
    const existing = entries.get(key);
    if (existing) {
      existing.ingredient = ingredient;
      existing.quantities.push(item.quantity);
    } else {
      entries.set(key, {
        ingredient,
        quantities: [item.quantity],
      });
    }
  }

  return [...entries.entries()]
    .map(([key, entry]) => ({
      key,
      ingredient: entry.ingredient,
      stock: entry.quantities.length > 0 ? formatStock(entry.quantities) : null,
    }))
    .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
}

export function findCatalogKey<T extends { name: string }>(
  catalog: IngredientCatalogEntry<T>[],
  name: string | undefined
) {
  if (!name) return "";
  return catalog.find((entry) => entry.ingredient.name === name)?.key ?? "";
}

export type FermentableCatalogEntry = IngredientCatalogEntry<FermentableType>;
export type HopCatalogEntry = IngredientCatalogEntry<HopVarietyBase>;
export type CultureCatalogEntry = IngredientCatalogEntry<CultureInformation>;
