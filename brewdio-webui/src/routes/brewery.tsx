import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { BreweryVisualization, type TankShape } from "@/components/brewery-visualization";
import { BreweryBatchSettings } from "@/components/brewery-batch-settings";
import { BreweryLossControls, type CalculatedStage } from "@/components/brewery-loss-controls";
import { getEquipment } from "brewdio-wasm";
import type { EquipmentItemType, EquipmentProfile } from "brewdio-wasm";
import { volumeToGallons, specificVolumeToGallonsPerKilogram } from "brewdio-wasm";
import { useQueryClient } from "@tanstack/react-query";
import {
  createEquipmentProfileImperative,
  deleteEquipmentProfileImperative,
  invalidateEquipmentProfiles,
  updateEquipmentProfileImperative,
  useEquipmentProfiles,
} from "@/lib/db/equipment";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/lib/db/settings";
import { gallonsToUnit, unitToGallons } from "@/lib/volume-units";

export const Route = createFileRoute("/brewery")({
  component: BreweryComponent,
});

interface CalculationResult {
  totalWaterNeeded: number;
  stages: CalculatedStage[];
}

/**
 * Map BeerJSON equipment form to visualization tank shape
 */
function getShapeFromForm(form: EquipmentItemType["form"]): TankShape {
  switch (form) {
    case "HLT":
      return "rect";
    case "Mash Tun":
    case "Lauter Tun":
      return "dome";
    case "Brew Kettle":
      return "chimney";
    case "Fermenter":
    case "Aging Vessel":
      return "conical";
    case "Packaging Vessel":
      return "keg";
    default:
      return "rect";
  }
}

/**
 * Get the appropriate loss label for the static loss based on equipment form
 */
function getLossLabel(item: EquipmentItemType): string {
  // Labels for the static loss field
  switch (item.form) {
    case "Mash Tun":
    case "Lauter Tun":
      return "Dead Space / Other Loss";
    case "Brew Kettle":
      return "Other Loss";
    case "Fermenter":
    case "Aging Vessel":
      return "Yeast/Cake Loss";
    case "Packaging Vessel":
      return "Transfer Loss";
    default:
      return "Loss";
  }
}

function BreweryComponent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const displayVolumeUnit = settings?.defaultVolumeUnit ?? "gal";
  const { data: equipmentProfiles = [] } = useEquipmentProfiles();
  const builtInProfileIds = useMemo(
    () => new Set(getEquipment().map((profile) => profile.id)),
    []
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>(equipmentProfiles[0]?.id || "default");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileErrorKey, setProfileErrorKey] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState("");

  // Brewery state
  const [targetVolume, setTargetVolume] = useState<number>(5.0);
  const [boilTime, setBoilTime] = useState<number>(60);
  const [grainWeight, setGrainWeight] = useState<number>(4.0);
  const [beerColor, setBeerColor] = useState<string>("#F59E0B");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  // Track pending changes
  const [hasChanges, setHasChanges] = useState(false);
  const [editedEquipment, setEditedEquipment] = useState<EquipmentItemType[] | null>(null);

  // Get current equipment profile
  const currentEquipment = equipmentProfiles?.find(
    (e) => e.id === selectedProfileId
  );
  const isBuiltInProfile = builtInProfileIds.has(selectedProfileId);

  // Load equipment items into editable state when profile changes
  useEffect(() => {
    if (currentEquipment) {
      setEditedEquipment(structuredClone(currentEquipment.equipment.equipment_items));
      setHasChanges(false);
      setProfileErrorKey(null);
    }
  }, [currentEquipment]);

  useEffect(() => {
    if (!currentEquipment && equipmentProfiles.length > 0) {
      setSelectedProfileId(equipmentProfiles[0].id);
    }
  }, [currentEquipment, equipmentProfiles]);

  // Calculate water needs from equipment (use edited version if available)
  const calculationData = useMemo((): CalculationResult => {
    const equipmentItems = editedEquipment || currentEquipment?.equipment.equipment_items;

    if (!equipmentItems) {
      return { totalWaterNeeded: 0, stages: [] };
    }

    let currentVol = targetVolume;
    const processedStages: CalculatedStage[] = [];

    // Process equipment items in reverse (from packaging back to source)
    [...equipmentItems].reverse().forEach((item) => {
      let stageLossTotal = 0;

      // Calculate loss based on type
      if (item.grain_absorption_rate) {
        // Grain absorption: rate * grain weight
        const rateInGalPerKg = specificVolumeToGallonsPerKilogram(item.grain_absorption_rate);
        stageLossTotal += rateInGalPerKg * grainWeight;
      }

      if (item.boil_rate_per_hour) {
        // Boil off: rate * time
        const rateInGalPerHr = volumeToGallons(item.boil_rate_per_hour);
        stageLossTotal += rateInGalPerHr * (boilTime / 60);
      }

      // Add static loss
      const staticLoss = volumeToGallons(item.loss);
      stageLossTotal += staticLoss;

      const volIn = currentVol + stageLossTotal;
      processedStages.push({
        id: item.name.toLowerCase().replace(/\s+/g, "-"),
        label: item.name,
        shape: getShapeFromForm(item.form),
        volumeIn: volIn,
        volumeOut: currentVol,
        totalLoss: stageLossTotal,
        lossLabel: getLossLabel(item),
        equipmentItem: item,
      });
      currentVol = volIn;
    });

    const orderedStages = processedStages.reverse();

    const sourceTank: CalculatedStage = {
      id: "source",
      label: "Strike Water",
      shape: "rect",
      volumeIn: currentVol,
      volumeOut: currentVol,
      totalLoss: 0,
      isSource: true,
      lossLabel: "",
    };

    return {
      totalWaterNeeded: currentVol,
      stages: [sourceTank, ...orderedStages],
    };
  }, [editedEquipment, currentEquipment, targetVolume, boilTime, grainWeight]);

  // Find selected stage and its index
  const selectedStageIndex = selectedStageId
    ? calculationData.stages.findIndex((s) => s.id === selectedStageId)
    : -1;
  const selectedStage =
    selectedStageIndex > 0 ? calculationData.stages[selectedStageIndex] : null;

  const handleAddProfile = async () => {
    const name = newProfileName.trim();
    if (!name || !currentEquipment) return;

    setIsSavingProfile(true);
    setProfileErrorKey(null);
    try {
      const newProfile: EquipmentProfile = structuredClone(currentEquipment);
      newProfile.id = "";
      newProfile.equipment.name = name;

      const id = await createEquipmentProfileImperative(newProfile);
      await invalidateEquipmentProfiles(queryClient);
      setSelectedProfileId(id);
      setNewProfileName("");
      setIsAddDialogOpen(false);
    } catch (error) {
      console.error("Failed to create equipment profile:", error);
      setProfileErrorKey("brewery.profileCreateFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!currentEquipment || isBuiltInProfile) return;

    setIsSavingProfile(true);
    setProfileErrorKey(null);
    try {
      await deleteEquipmentProfileImperative(currentEquipment.id);
      await invalidateEquipmentProfiles(queryClient);
      setSelectedProfileId(equipmentProfiles.find((profile) =>
        builtInProfileIds.has(profile.id)
      )?.id ?? equipmentProfiles[0]?.id ?? "default");
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Failed to delete equipment profile:", error);
      setProfileErrorKey("brewery.profileDeleteFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleLossChange = (stageIndex: number, newLossValue: number) => {
    if (isBuiltInProfile || !editedEquipment || stageIndex <= 0) return;

    const equipmentItemIndex = stageIndex - 1;
    const newEquipment = [...editedEquipment];

    if (newEquipment[equipmentItemIndex]) {
      newEquipment[equipmentItemIndex] = {
        ...newEquipment[equipmentItemIndex],
        loss: { value: newLossValue, unit: "gal" },
      };

      setEditedEquipment(newEquipment);
      setHasChanges(true);
    }
  };

  const handleStageNameChange = (stageIndex: number, newName: string) => {
    if (isBuiltInProfile || !editedEquipment || stageIndex <= 0) return;

    const equipmentItemIndex = stageIndex - 1;
    const newEquipment = [...editedEquipment];

    if (newEquipment[equipmentItemIndex]) {
      newEquipment[equipmentItemIndex] = {
        ...newEquipment[equipmentItemIndex],
        name: newName,
      };

      setEditedEquipment(newEquipment);
      setHasChanges(true);
    }
  };

  const handleGrainAbsorptionChange = (stageIndex: number, newRate: number) => {
    if (isBuiltInProfile || !editedEquipment || stageIndex <= 0) return;

    const equipmentItemIndex = stageIndex - 1;
    const newEquipment = [...editedEquipment];

    if (newEquipment[equipmentItemIndex]) {
      newEquipment[equipmentItemIndex] = {
        ...newEquipment[equipmentItemIndex],
        grain_absorption_rate: { value: newRate, unit: "l/kg" },
      };

      setEditedEquipment(newEquipment);
      setHasChanges(true);
    }
  };

  const handleBoilRateChange = (stageIndex: number, newRate: number) => {
    if (isBuiltInProfile || !editedEquipment || stageIndex <= 0) return;

    const equipmentItemIndex = stageIndex - 1;
    const newEquipment = [...editedEquipment];

    if (newEquipment[equipmentItemIndex]) {
      newEquipment[equipmentItemIndex] = {
        ...newEquipment[equipmentItemIndex],
        boil_rate_per_hour: { value: newRate, unit: "gal" },
      };

      setEditedEquipment(newEquipment);
      setHasChanges(true);
    }
  };

  const handleSave = async () => {
    if (!currentEquipment || isBuiltInProfile || !editedEquipment) return;

    setIsSavingProfile(true);
    setProfileErrorKey(null);
    try {
      const updatedProfile: EquipmentProfile = {
        ...structuredClone(currentEquipment),
        equipment: {
          ...structuredClone(currentEquipment.equipment),
          equipment_items: structuredClone(editedEquipment),
        },
      };

      await updateEquipmentProfileImperative(currentEquipment.id, updatedProfile);
      await invalidateEquipmentProfiles(queryClient);
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save equipment profile:", error);
      setProfileErrorKey("brewery.profileSaveFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCancel = () => {
    if (currentEquipment) {
      setEditedEquipment(currentEquipment.equipment.equipment_items);
      setHasChanges(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Equipment Profile Selector and Save/Cancel */}
      <div className="flex items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">Brewery</h1>
          <p className="text-muted-foreground mt-2">
            Configure your brewery equipment and visualize water losses.
          </p>
        </div>

        {/* Equipment Profile Selector and Actions - Right Side */}
        <div className="flex items-center gap-3">
          {hasChanges && !isBuiltInProfile && (
            <>
              <Button onClick={handleCancel} variant="outline">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSavingProfile}>Save Changes</Button>
            </>
          )}
          <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Select equipment profile" />
            </SelectTrigger>
            <SelectContent>
              {equipmentProfiles?.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.equipment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="default" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Profile
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Equipment Profile</DialogTitle>
                <DialogDescription>
                  Create a new equipment profile to track different brewery setups.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Profile Name</Label>
                  <Input
                    id="profile-name"
                    placeholder="e.g., 10 Gallon System"
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleAddProfile();
                      }
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || isSavingProfile}
                >
                  Add Profile
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {!isBuiltInProfile && currentEquipment && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => setIsDeleteDialogOpen(true)}
              title="Delete profile"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {profileErrorKey && (
        <p className="text-sm text-destructive">{t(profileErrorKey)}</p>
      )}

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("brewery.deleteProfileTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("brewery.deleteProfileDescription", {
                profileName: currentEquipment?.equipment.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSavingProfile}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProfile}
              disabled={isSavingProfile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Visualization - Full Width */}
      <div className="mt-2">
        <BreweryVisualization
          stages={calculationData.stages}
          beerColor={beerColor}
          totalWaterNeeded={calculationData.totalWaterNeeded}
          volumeUnit={displayVolumeUnit}
          selectedStageId={selectedStageId}
          onBeerColorChange={setBeerColor}
          onStageSelect={setSelectedStageId}
        />
      </div>

      {/* Controls Below - Two Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left - Batch Settings */}
        <BreweryBatchSettings
          targetVolume={gallonsToUnit(targetVolume, displayVolumeUnit)}
          boilTime={boilTime}
          grainWeight={grainWeight}
          volumeUnit={displayVolumeUnit}
          onTargetVolumeChange={(value) =>
            setTargetVolume(unitToGallons(value, displayVolumeUnit))
          }
          onBoilTimeChange={setBoilTime}
          onGrainWeightChange={setGrainWeight}
        />

        {/* Right - Selected Stage Loss Controls */}
        <BreweryLossControls
          stage={selectedStage}
          stageIndex={selectedStageIndex}
          grainWeight={grainWeight}
          boilTime={boilTime}
          onLossChange={handleLossChange}
          onGrainAbsorptionChange={handleGrainAbsorptionChange}
          onBoilRateChange={handleBoilRateChange}
          onNameChange={handleStageNameChange}
          readOnly={isBuiltInProfile}
          volumeUnit={displayVolumeUnit}
        />
      </div>
    </div>
  );
}
