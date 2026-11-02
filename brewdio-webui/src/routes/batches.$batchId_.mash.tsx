import { createFileRoute } from "@tanstack/react-router";
import { useBatch } from "@/lib/db/batches";
import { RecipeEditProvider } from "@/contexts/recipe-edit-context";
import { RecipeMashSection } from "@/components/recipe-mash-section";
import { useEffect } from "react";
import { stores } from "@/lib/calculate";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/batches/$batchId_/mash")({
  component: BatchMashComponent,
});

function BatchMashComponent() {
  const { t } = useTranslation();
  const { batchId } = Route.useParams();
  const { data: batch, status } = useBatch(batchId);

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

  return (
    <RecipeEditProvider id={batchId} document={batch} type="batch">
      <div className="flex flex-col gap-6">
        <RecipeMashSection />
      </div>
    </RecipeEditProvider>
  );
}
