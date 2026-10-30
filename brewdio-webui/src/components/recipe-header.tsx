import { InlineEditable } from "@/components/inline-editable";
import { EditableStyleSelector } from "@/components/editable-style-selector";
import { EditableTypeSelector } from "@/components/editable-type-selector";
import { EditableEquipmentSelector } from "@/components/editable-equipment-selector";
import { DeleteRecipeDialog } from "@/components/delete-recipe-dialog";
import { DeleteBatchDialog } from "@/components/delete-batch-dialog";
import { BrewBatchDialog } from "@/components/brew-batch-dialog";
import { Input } from "@/components/ui/input";
import type { RecipeDocument } from "@/lib/db/recipes";
import type { BatchDocument } from "@/lib/db/batches";
import { recipeKeys } from "@/lib/db/recipes";
import { getBackend } from "@/lib/db/app-db";
import { useQueryClient } from "@tanstack/react-query";
import { getStyles, type EquipmentProfile, type RecipeTypeType, type RecipeStyleType, type StyleCategories } from "brewdio-wasm";
import { useTranslation } from "react-i18next";

interface RecipeHeaderProps {
  recipe: RecipeDocument;
  showDelete?: boolean;
  redirectOnDelete?: boolean;
  showBrew?: boolean;
  batch?: BatchDocument;
  onBatchUpdate?: (updates: Partial<BatchDocument>) => void;
}

export function RecipeHeader({
  recipe,
  showDelete = true,
  redirectOnDelete = false,
  showBrew = true,
  batch,
  onBatchUpdate,
}: RecipeHeaderProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isBatchMode = !!batch;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: recipeKeys.all });
    queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipe.id) });
  };

  const handleNameUpdate = async (newName: string) => {
    if (isBatchMode && onBatchUpdate) {
      onBatchUpdate({ name: newName });
      return;
    }
    const updated = structuredClone(recipe.recipe);
    updated.name = newName;
    await getBackend().updateRecipe(recipe.id, newName, updated);
    invalidate();
  };

  const handleTypeUpdate = async (newType: string) => {
    if (isBatchMode && onBatchUpdate) {
      const updatedRecipe = structuredClone(batch!.recipe);
      updatedRecipe.type = newType as RecipeTypeType;
      onBatchUpdate({ recipe: updatedRecipe } as Partial<BatchDocument>);
      return;
    }
    const updated = structuredClone(recipe.recipe);
    updated.type = newType as RecipeTypeType;
    await getBackend().updateRecipe(recipe.id, updated.name, updated);
    invalidate();
  };

  const handleStyleUpdate = async (newStyleName: string) => {
    const selectedStyle = getStyles().find((s) => s.name === newStyleName);
    if (!selectedStyle) {
      throw new Error(`Style "${newStyleName}" not found`);
    }

    const styleData: RecipeStyleType = {
      name: selectedStyle.name,
      category: selectedStyle.category,
      category_number: selectedStyle.category_number,
      style_guide: selectedStyle.style_guide,
      style_letter: selectedStyle.style_letter,
      type: selectedStyle.type as StyleCategories,
    };

    if (isBatchMode && onBatchUpdate) {
      const updatedRecipe = structuredClone(batch!.recipe);
      updatedRecipe.style = styleData;
      onBatchUpdate({ recipe: updatedRecipe } as Partial<BatchDocument>);
      return;
    }

    const updated = structuredClone(recipe.recipe);
    updated.style = styleData;
    await getBackend().updateRecipe(recipe.id, updated.name, updated);
    invalidate();
  };

  const handleEquipmentUpdate = async (profile: EquipmentProfile | null) => {
    if (isBatchMode && onBatchUpdate) {
      if (profile) {
        const updatedRecipe = structuredClone(batch!.recipe);
        updatedRecipe.efficiency = profile.efficiency;
        onBatchUpdate({
          equipmentId: profile.id,
          equipment: structuredClone(profile.equipment),
          recipe: updatedRecipe,
        } as Partial<BatchDocument>);
      } else {
        onBatchUpdate({
          equipmentId: undefined,
          equipment: undefined,
        } as Partial<BatchDocument>);
      }
      return;
    }
    if (profile) {
      await getBackend().setRecipeEquipment(recipe.id, profile.equipment, profile.id);
      const updated = structuredClone(recipe.recipe);
      updated.efficiency = profile.efficiency;
      await getBackend().updateRecipe(recipe.id, updated.name, updated);
    } else {
      await getBackend().setRecipeEquipment(recipe.id, undefined, undefined);
    }
    invalidate();
  };

  const handleBrewDateChange = (newDate: string) => {
    if (onBatchUpdate) {
      const timestamp = new Date(newDate).getTime();
      onBatchUpdate({ brewDate: timestamp });
    }
  };

  // Format brew date for the input
  const brewDateInputValue = batch
    ? new Date(batch.brewDate).toISOString().split("T")[0]
    : undefined;

  const displayName = isBatchMode ? batch!.name : recipe.recipe.name;
  const displayRecipe = isBatchMode ? batch!.recipe : recipe.recipe;
  const displayEquipment = isBatchMode ? batch!.equipment : recipe.equipment;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3">
          <InlineEditable
            value={displayName}
            onSave={handleNameUpdate}
            displayAs="heading"
            placeholder={isBatchMode ? t("batches.namePlaceholder") : t("recipes.namePlaceholderShort")}
          />
          {isBatchMode && brewDateInputValue && (
            <Input
              type="date"
              value={brewDateInputValue}
              onChange={(e) => handleBrewDateChange(e.target.value)}
              className="w-auto h-7 text-xs text-muted-foreground"
            />
          )}
          {!isBatchMode && recipe.recipe.author && (
            <p className="text-xs text-muted-foreground/70 shrink-0">
              {t("common.by")} {recipe.recipe.author}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {displayRecipe.style && (
            <div className="flex items-center gap-3 flex-wrap">
              <EditableStyleSelector
                styleName={displayRecipe.style.name}
                styleCategory={displayRecipe.style.category}
                onSave={handleStyleUpdate}
              />
              <span className="text-muted-foreground/40">·</span>
              <EditableTypeSelector
                type={displayRecipe.type}
                onSave={handleTypeUpdate}
              />
            </div>
          )}
          <div className="ml-auto">
            <EditableEquipmentSelector
              equipment={displayEquipment}
              onSave={handleEquipmentUpdate}
            />
          </div>
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {!isBatchMode && showBrew && <BrewBatchDialog recipe={recipe} />}
        {isBatchMode ? (
          <DeleteBatchDialog
            batchId={batch!.id}
            batchName={batch!.name}
            variant="destructive"
            size="sm"
            redirectOnDelete={redirectOnDelete}
          />
        ) : (
          showDelete && (
            <DeleteRecipeDialog
              recipeId={recipe.id}
              recipeName={recipe.recipe.name}
              redirectOnDelete={redirectOnDelete}
            />
          )
        )}
      </div>
    </div>
  );
}
