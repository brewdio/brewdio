import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useBatch, updateBatchImperative, batchKeys } from "@/lib/db/batches";
import type { BatchDocument } from "@/lib/db/batches";
import { useRecipe } from "@/lib/db/recipes";
import { useQueryClient } from "@tanstack/react-query";
import { RecipeEditProvider } from "@/contexts/recipe-edit-context";
import { RecipeHeader } from "@/components/recipe-header";
import { RecipeDetailView } from "@/components/recipe-detail-view";
import { useEffect } from "react";
import { stores } from "@/lib/calculate";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { RecipeType } from "brewdio-wasm";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/batches/$batchId")({
  component: BatchDetailComponent,
});

function BatchDetailComponent() {
  const { t, i18n } = useTranslation();
  const { batchId } = Route.useParams();
  const { data: batch, status } = useBatch(batchId);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Fetch the original recipe to get its current name
  const { data: originalRecipe } = useRecipe(batch?.recipeId ?? "");

  // Helper to update the batch via WASM and invalidate queries
  const persistBatch = (updates: Partial<BatchDocument>) => {
    if (!batch) return;
    const updated = { ...batch, ...updates, updatedAt: Date.now() };
    updateBatchImperative(batchId, updated.name, {
      equipmentId: updated.equipmentId,
      recipe: updated.recipe,
      equipment: updated.equipment,
      brewDate: updated.brewDate,
      notes: updated.notes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
    queryClient.invalidateQueries({ queryKey: batchKeys.all });
    queryClient.invalidateQueries({ queryKey: batchKeys.detail(batchId) });
  };

  const updateRecipe = (mutateFn: (r: RecipeType) => void) => {
    if (!batch) return;
    const updated = structuredClone(batch.recipe);
    mutateFn(updated);
    persistBatch({ recipe: updated });
  };

  const handleBatchUpdate = (updates: Partial<BatchDocument>) => {
    persistBatch(updates);
  };

  // Handle hash navigation for scrolling to sections
  useEffect(() => {
    const hash = router.state.location.hash;
    if (hash) {
      setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [router.state.location.hash]);

  // Sync batch's recipe data to calculation store
  useEffect(() => {
    if (batch) {
      stores.state.setState(() => ({
        recipe: batch.recipe,
      }));
    }
  }, [batch]);

  if (status === "pending") {
    return <div>{t("batches.loadingOne")}</div>;
  }

  if (!batch) {
    return <div>{t("batches.notFound")}</div>;
  }

  // Format brew date
  const brewDate = new Date(batch.brewDate);
  const brewDateStr = brewDate.toLocaleDateString(
    i18n.resolvedLanguage?.startsWith("nb") ? "nb-NO" : "en-US",
    {
    year: "numeric",
    month: "long",
    day: "numeric",
    }
  );

  // Use the original recipe's current name, falling back to the batch's copy
  const originalRecipeName = originalRecipe?.recipe.name ?? batch.recipe.name;

  // Build a RecipeDocument-shaped object so RecipeHeader can work with it
  const recipeDoc = {
    id: batch.recipeId,
    name: batch.recipe.name,
    recipe: batch.recipe,
    equipment: batch.equipment,
  };

  return (
    <RecipeEditProvider id={batchId} document={batch} type="batch">
      <RecipeDetailView
        recipe={batch.recipe}
        equipment={batch.equipment}
        updateRecipe={updateRecipe}
        notesLabel={t("batches.notesLabel")}
        notesPlaceholder={t("batches.notesPlaceholder")}
        headerSlot={
          <RecipeHeader
            recipe={recipeDoc}
            batch={batch}
            onBatchUpdate={handleBatchUpdate}
            redirectOnDelete={true}
          />
        }
        alertSlot={
          <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-900 dark:text-blue-100">
              {t("batches.brewedOn", { date: brewDateStr })}{" "}
              {t("batches.changesOnlyAffectBatch")}{" "}
              <Link
                to="/recipes/$recipeId"
                params={{ recipeId: batch.recipeId }}
                className="underline hover:text-blue-700 dark:hover:text-blue-300"
              >
                {t("batches.viewRecipe", { recipeName: originalRecipeName })}
              </Link>
            </AlertDescription>
          </Alert>
        }
      />
    </RecipeEditProvider>
  );
}
