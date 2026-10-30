import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useBatches, createBatchImperative, batchKeys } from "@/lib/db/batches";
import { useQueryClient } from "@tanstack/react-query";
import type { RecipeDocument } from "@/lib/db/recipes";
import { useEquipmentProfiles } from "@/lib/db/equipment";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Beaker } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BrewBatchDialogProps {
  recipe: RecipeDocument;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BrewBatchDialog({ recipe, open: controlledOpen, onOpenChange }: BrewBatchDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: batches } = useBatches();
  const queryClient = useQueryClient();

  const { data: equipmentProfiles = [] } = useEquipmentProfiles();
  const defaultEquipment = equipmentProfiles[0];

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [isCreating, setIsCreating] = useState(false);

  // Generate default batch name
  const recipeBatches = batches?.filter(b => b.recipeId === recipe.id) || [];
  const batchNumber = recipeBatches.length + 1;
  const defaultBatchName = t("batches.defaultName", {
    recipeName: recipe.recipe.name,
    number: batchNumber,
  });

  const [batchName, setBatchName] = useState(defaultBatchName);
  const recipeEquipmentName = recipe.equipment?.name;
  const initialEquipmentName = recipeEquipmentName || defaultEquipment?.equipment.name || "Default Setup";

  const [selectedEquipmentName, setSelectedEquipmentName] = useState(initialEquipmentName);

  // Reset form when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      // Recalculate batch number in case new batches were created
      const currentBatches = batches?.filter(b => b.recipeId === recipe.id) || [];
      const newBatchNumber = currentBatches.length + 1;
      setBatchName(t("batches.defaultName", {
        recipeName: recipe.recipe.name,
        number: newBatchNumber,
      }));
      setSelectedEquipmentName(recipe.equipment?.name || defaultEquipment?.equipment.name || "Default Setup");
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Get selected equipment
      const profile = equipmentProfiles.find(e => e.equipment.name === selectedEquipmentName) || defaultEquipment;

      const batchId = await createBatchImperative(
        batchName.trim() || defaultBatchName,
        recipe.id,
        {
          equipmentId: profile?.id || "default",
          recipe: structuredClone(recipe.recipe),
          equipment: structuredClone(profile?.equipment),
          brewDate: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      );

      await queryClient.invalidateQueries({ queryKey: batchKeys.all });
      setOpen(false);
      navigate({
        to: "/batches/$batchId",
        params: { batchId },
      });
    } catch (error) {
      console.error("Failed to create batch:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button variant="default">
            <Beaker className="h-4 w-4 mr-2" />
            {t("batches.brewAction")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("batches.brewTitle")}</DialogTitle>
          <DialogDescription>
            {t("batches.brewDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Batch Name */}
          <div className="space-y-2">
            <Label htmlFor="batch-name">{t("batches.nameLabel")}</Label>
            <Input
              id="batch-name"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder={defaultBatchName}
              disabled={isCreating}
            />
          </div>

          {/* Equipment Profile */}
          <div className="space-y-2">
            <Label htmlFor="equipment-profile">{t("equipment.profile")}</Label>
            <select
              id="equipment-profile"
              value={selectedEquipmentName}
              onChange={(e) => setSelectedEquipmentName(e.target.value)}
              disabled={isCreating}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {equipmentProfiles.map((profile) => (
                <option key={profile.id} value={profile.equipment.name}>
                  {profile.equipment.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t("equipment.profileHelp")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isCreating}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating}
          >
            {isCreating ? t("batches.creating") : t("batches.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
