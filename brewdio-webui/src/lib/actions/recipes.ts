import { createRecipeImperative, updateRecipeImperative, deleteRecipeImperative } from '@/lib/db/recipes';
import type { RecipeType, StyleType, VolumeUnitType } from 'brewdio-wasm';
import { getStyles, getMashProfiles } from 'brewdio-wasm';

export interface CreateRecipeParams {
  name: string;
  batchSize: number;
  batchSizeUnit?: VolumeUnitType;
  styleName: string;
  author?: string;
}

export interface UpdateRecipeParams {
  recipeId: string;
  recipe: RecipeType;
}

/**
 * Create a new recipe with basic BeerJSON structure
 */
export async function createRecipe(params: CreateRecipeParams): Promise<string> {
  const { name, batchSize, batchSizeUnit = 'gal', styleName, author = 'Brewdio User' } = params;

  // Find the selected style from the styles data
  const selectedStyle = getStyles().find((s) => s.name === styleName);

  if (!selectedStyle) {
    throw new Error(`Style "${styleName}" not found`);
  }

  // Use default mash profile from static data
  const mashProfiles = getMashProfiles();
  const defaultMash = mashProfiles[0]; // "Single Infusion (F)"

  // Create a basic BeerJSON recipe
  const newRecipe: RecipeType = {
    name,
    type: 'all grain',
    author,
    batch_size: {
      value: batchSize,
      unit: batchSizeUnit,
    },
    boil: {
      boil_time: {
        value: 60,
        unit: 'min',
      },
      pre_boil_size: {
        value: batchSize * 1.3, // Default 30% boil-off
        unit: batchSizeUnit,
      },
    },
    efficiency: {
      brewhouse: { value: 72, unit: "%" },
      conversion: { value: 100, unit: "%" },
      lauter: { value: 95, unit: "%" },
      mash: { value: 95, unit: "%" },
    },
    style: selectedStyle as StyleType,
    ingredients: {
      fermentable_additions: [],
      hop_additions: [],
      culture_additions: [],
    },
    mash: defaultMash ? structuredClone(defaultMash) : undefined,
  };

  const recipeId = await createRecipeImperative(name, newRecipe);

  return recipeId;
}

/**
 * Validate that a recipe has the required BeerJSON structure
 */
function validateRecipeStructure(recipe: RecipeType): void {
  if (!recipe.name) {
    throw new Error('Recipe must have a name');
  }
  if (!recipe.batch_size) {
    throw new Error('Recipe must have a batch_size');
  }
  if (!recipe.ingredients) {
    throw new Error('Recipe must have an ingredients object');
  }
  // Ensure ingredients arrays exist (can be empty)
  if (!Array.isArray(recipe.ingredients.fermentable_additions)) {
    recipe.ingredients.fermentable_additions = [];
  }
  if (!Array.isArray(recipe.ingredients.hop_additions)) {
    recipe.ingredients.hop_additions = [];
  }
  if (!Array.isArray(recipe.ingredients.culture_additions)) {
    recipe.ingredients.culture_additions = [];
  }
}

/**
 * Update an existing recipe with validation
 */
export async function updateRecipe(params: UpdateRecipeParams): Promise<void> {
  const { recipeId, recipe } = params;

  // Validate the recipe structure before updating
  validateRecipeStructure(recipe);

  await updateRecipeImperative(recipeId, recipe.name, recipe);
}

/**
 * Delete a recipe by ID
 */
export async function deleteRecipe(recipeId: string): Promise<void> {
  await deleteRecipeImperative(recipeId);
}

/**
 * Get all available beer styles
 */
export function getAvailableStyles(): Array<{ name: string; category: string }> {
  return getStyles().map((s) => ({ name: s.name, category: s.category }));
}
