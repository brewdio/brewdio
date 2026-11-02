import { createFileRoute } from "@tanstack/react-router";
import { useBatch } from "@/lib/db/batches";
import { useCalculation } from "@/hooks/use-calculation";
import { useEffect } from "react";
import { stores } from "@/lib/calculate";
import { srmToSrgb, rgbToHex } from "brewdio-wasm";
import { WaterCalculator } from "@/components/batch-water-calculator";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/batches/$batchId_/water")({
  component: BatchWaterComponent,
});

function BatchWaterComponent() {
  const { t } = useTranslation();
  const { batchId } = Route.useParams();
  const { data: batch, status } = useBatch(batchId);
  const color = useCalculation<number>("color");

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

  const liquidColor = color
    ? (() => {
        const rgb = srmToSrgb(color) as [number, number, number];
        return rgbToHex(rgb[0], rgb[1], rgb[2]);
      })()
    : "#FBB123";

  return (
    <div className="flex flex-col gap-6">
      <WaterCalculator
        recipe={batch.recipe}
        equipment={batch.equipment}
        beerColor={liquidColor}
      />
    </div>
  );
}
