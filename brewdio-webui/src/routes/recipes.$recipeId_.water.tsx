import { createFileRoute } from "@tanstack/react-router";
import { useRecipe } from "@/lib/db/recipes";
import { useCalculation } from "@/hooks/use-calculation";
import { useEffect } from "react";
import { stores } from "@/lib/calculate";
import { srmToSrgb, rgbToHex } from "brewdio-wasm";
import { WaterCalculator } from "@/components/batch-water-calculator";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/recipes/$recipeId_/water")({
  component: RecipeWaterComponent,
});

function RecipeWaterComponent() {
  const { t } = useTranslation();
  const { recipeId } = Route.useParams();
  const { data: recipe, status } = useRecipe(recipeId);
  const color = useCalculation<number>("color");

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

  const liquidColor = color
    ? (() => {
        const rgb = srmToSrgb(color) as [number, number, number];
        return rgbToHex(rgb[0], rgb[1], rgb[2]);
      })()
    : "#FBB123";

  return (
    <div className="flex flex-col gap-6">
      <WaterCalculator
        recipe={recipe.recipe}
        equipment={recipe.equipment}
        beerColor={liquidColor}
      />
    </div>
  );
}
