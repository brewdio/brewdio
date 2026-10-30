import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useBatches } from "@/lib/db/batches";
import { useRecipes } from "@/lib/db/recipes";
import { CreateRecipeDialog } from "@/components/create-recipe-dialog";
import { DeleteRecipeDialog } from "@/components/delete-recipe-dialog";
import { Calendar, Beaker } from "lucide-react";
import { useCommandHandler } from "@/hooks/use-command";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { t } = useTranslation();

  const { data: recipes, status: recipesStatus } = useRecipes();
  const { data: batches, status: batchesStatus } = useBatches();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useCommandHandler(
    "recipe.create",
    useCallback(() => setCreateDialogOpen(true), [])
  );

  // Sort batches by brew date (most recent first)
  const sortedBatches = batches ? [...batches].sort((a, b) => b.brewDate - a.brewDate) : [];
  const recentBatches = sortedBatches.slice(0, 6); // Show 6 most recent

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Command-controlled create dialog */}
      <CreateRecipeDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {/* Recipes Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">{t("recipes")}</h1>
          <CreateRecipeDialog />
        </div>

        {recipesStatus === "pending" && <div>Loading recipes...</div>}

        {recipesStatus === "success" && recipes.length === 0 && (
          <div className="text-muted-foreground text-center py-12">
            No recipes yet. Create your first recipe to get started!
          </div>
        )}

        {recipesStatus === "success" && recipes.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipeDoc) => (
              <div key={recipeDoc.id} className="border rounded-lg p-4 hover:bg-accent transition-colors">
                <Link
                  to="/recipes/$recipeId"
                  params={{ recipeId: recipeDoc.id }}
                  className="block"
                >
                  <h2 className="text-xl font-semibold mb-2">
                    {recipeDoc.recipe.name}
                  </h2>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Type: {recipeDoc.recipe.type}</div>
                    <div>
                      Batch Size: {recipeDoc.recipe.batch_size.value}{" "}
                      {recipeDoc.recipe.batch_size.unit}
                    </div>
                    {recipeDoc.recipe.style && (
                      <div>Style: {recipeDoc.recipe.style.name}</div>
                    )}
                  </div>
                </Link>
                <div className="mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                  <DeleteRecipeDialog
                    recipeId={recipeDoc.id}
                    recipeName={recipeDoc.recipe.name}
                    variant="outline"
                    size="sm"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batches Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Beaker className="h-6 w-6" />
            Recent Batches
          </h2>
        </div>

        {batchesStatus === "pending" && <div>Loading batches...</div>}

        {batchesStatus === "success" && batches.length === 0 && (
          <div className="text-muted-foreground text-center py-8 border rounded-lg">
            No batches yet. Click "Brew" on a recipe to start your first batch!
          </div>
        )}

        {batchesStatus === "success" && batches.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentBatches.map((batch) => (
              <Link
                key={batch.id}
                to="/batches/$batchId"
                params={{ batchId: batch.id }}
                className="block border rounded-lg p-4 hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold">{batch.name}</h3>
                  <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Recipe: {batch.recipe.name}</div>
                  <div>Brewed: {formatDate(batch.brewDate)}</div>
                  <div>
                    {batch.recipe.batch_size.value} {batch.recipe.batch_size.unit}
                    {batch.recipe.style && ` • ${batch.recipe.style.name}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {batchesStatus === "success" && batches.length > 6 && (
          <div className="text-center text-sm text-muted-foreground">
            Showing 6 most recent batches
          </div>
        )}
      </div>
    </div>
  );
}
