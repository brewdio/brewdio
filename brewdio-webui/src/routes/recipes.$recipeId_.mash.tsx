import { createFileRoute } from "@tanstack/react-router";
import { useRecipe } from "@/lib/db/recipes";
import { RecipeEditProvider } from "@/contexts/recipe-edit-context";
import { RecipeMashSection } from "@/components/recipe-mash-section";
import { useEffect } from "react";
import { stores } from "@/lib/calculate";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/recipes/$recipeId_/mash")({
  component: RecipeMashComponent,
});

function RecipeMashComponent() {
  const { t } = useTranslation();
  const { recipeId } = Route.useParams();
  const { data: recipe, status } = useRecipe(recipeId);

  // Sync recipe data to calculation store
  useEffect(() => {
    if (recipe) {
      stores.state.setState(() => ({
        recipe: recipe.recipe,
      }));
    }
  }, [recipe]);

  if (status === "pending") {
    return <div>{t("recipes.loadingOne")}</div>;
  }

  if (!recipe) {
    return <div>{t("recipes.notFound")}</div>;
  }

  return (
    <RecipeEditProvider id={recipeId} document={recipe} type="recipe">
      <div className="flex flex-col gap-6">
        <RecipeMashSection />
      </div>
    </RecipeEditProvider>
  );
}
