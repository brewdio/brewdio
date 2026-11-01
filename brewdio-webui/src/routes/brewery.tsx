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
  strikeWater: number;
  spargeWater: number;
  grainVolume: number;
  mashVolume: number;
  mashCapacity: number;
  stages: CalculatedStage[];
}

const GRAIN_DISPLACEMENT_LITERS_PER_KILOGRAM = 0.652;

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
function getLossLabelKey(item: EquipmentItemType): string {
  switch (item.form) {
    case "Mash Tun":
    case "Lauter Tun":
      return "brewery.lossLabels.deadSpaceOther";
    case "Brew Kettle":
      return "brewery.lossLabels.other";
    case "Fermenter":
    case "Aging Vessel":
      return "brewery.lossLabels.yeastCake";
    case "Packaging Vessel":
      return "brewery.lossLabels.transfer";
    default:
      return "brewery.lossLabels.loss";
  }
}

function getEquipmentLabelKey(form: EquipmentItemType["form"]): string {
  switch (form) {
    case "HLT":
      return "brewery.equipmentForms.hlt";
    case "Mash Tun":
      return "brewery.equipmentForms.mashTun";
    case "Lauter Tun":
      return "brewery.equipmentForms.lauterTun";
    case "Brew Kettle":
      return "brewery.equipmentForms.brewKettle";
    case "Fermenter":
      return "brewery.equipmentForms.fermenter";
    case "Aging Vessel":
      return "brewery.equipmentForms.agingVessel";
    case "Packaging Vessel":
      return "brewery.equipmentForms.packagingVessel";
    default:
      return "brewery.equipmentForms.other";
  }
}

const standardEquipmentNames: Partial<
  Record<EquipmentItemType["form"], string[]>
> = {
  HLT: ["HLT", "Hot Liquor Tank", "Varmtvannstank"],
  "Mash Tun": ["Mash Tun", "Meskekar"],
  "Lauter Tun": ["Lauter Tun", "Silkar"],
  "Brew Kettle": ["Brew Kettle", "Boil Kettle", "Kokekjele"],
  Fermenter: ["Fermenter", "Gjæringskar"],
  "Aging Vessel": ["Aging Vessel", "Modningskar"],
  "Packaging Vessel": ["Packaging", "Packaging Vessel", "Kegging", "Tapping"],
};

function hasStandardEquipmentName(item: EquipmentItemType): boolean {
  return standardEquipmentNames[item.form]?.includes(item.name) ?? false;
}

function getBuiltInProfileNameKey(profileId: string): string | null {
  switch (profileId) {
    case "default-setup":
      return "brewery.builtInProfiles.defaultSetup";
    case "biab-no-sparge":
      return "brewery.builtInProfiles.biabNoSparge";
    case "biab-sparge":
      return "brewery.builtInProfiles.biabSparge";
    default:
      return null;
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
      return {
        totalWaterNeeded: 0,
        strikeWater: 0,
        spargeWater: 0,
        grainVolume: 0,
        mashVolume: 0,
        mashCapacity: 0,
        stages: [],
      };
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
        label: isBuiltInProfile || hasStandardEquipmentName(item)
          ? t(getEquipmentLabelKey(item.form))
          : item.name,
        shape: getShapeFromForm(item.form),
        volumeIn: volIn,
        volumeOut: currentVol,
        totalLoss: stageLossTotal,
        lossLabel: t(getLossLabelKey(item)),
        equipmentItem: item,
      });
      currentVol = volIn;
    });

    const orderedStages = processedStages.reverse();
    const mashVessel = equipmentItems.find(
      (item) => item.form === "Mash Tun" || item.form === "Lauter Tun"
    ) ?? equipmentItems.find(
      (item) => item.form === "Brew Kettle" && item.grain_absorption_rate
    ) ?? equipmentItems.find((item) => item.form === "Brew Kettle");
    const mashCapacity = mashVessel
      ? volumeToGallons(mashVessel.maximum_volume)
      : currentVol;
    const grainVolume = unitToGallons(
      grainWeight * GRAIN_DISPLACEMENT_LITERS_PER_KILOGRAM,
      "l"
    );
    const maximumStrikeWater = Math.max(0, mashCapacity - grainVolume);
    const strikeWater = Math.min(currentVol, maximumStrikeWater);
    const spargeWater = Math.max(0, currentVol - strikeWater);

    const sourceTank: CalculatedStage = {
      id: "source",
      label: t("brewery.totalWater"),
      shape: "rect",
      volumeIn: currentVol,
      volumeOut: currentVol,
      totalLoss: 0,
      isSource: true,
      lossLabel: "",
    };

    return {
      totalWaterNeeded: currentVol,
      strikeWater,
      spargeWater,
      grainVolume,
      mashVolume: strikeWater + grainVolume,
      mashCapacity,
      stages: [sourceTank, ...orderedStages],
    };
  }, [editedEquipment, currentEquipment, targetVolume, boilTime, grainWeight, isBuiltInProfile, t]);

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

  const handleMaximumVolumeChange = (stageIndex: number, newVolume: number) => {
    if (isBuiltInProfile || !editedEquipment || stageIndex <= 0) return;

    const equipmentItemIndex = stageIndex - 1;
    const newEquipment = [...editedEquipment];

    if (newEquipment[equipmentItemIndex]) {
      newEquipment[equipmentItemIndex] = {
        ...newEquipment[equipmentItemIndex],
        maximum_volume: { value: newVolume, unit: "gal" },
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
          <h1 className="text-3xl font-bold">{t("brewery.title")}</h1>
          <p className="text-muted-foreground mt-2">
            {t("brewery.description")}
          </p>
        </div>

        {/* Equipment Profile Selector and Actions - Right Side */}
        <div className="flex items-center gap-3">
          {hasChanges && !isBuiltInProfile && (
            <>
              <Button onClick={handleCancel} variant="outline">
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={isSavingProfile}>
                {t("brewery.saveChanges")}
              </Button>
            </>
          )}
          <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder={t("brewery.selectProfile")} />
            </SelectTrigger>
            <SelectContent>
              {equipmentProfiles?.map((profile) => {
                const profileNameKey = getBuiltInProfileNameKey(profile.id);
                return (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profileNameKey ? t(profileNameKey) : profile.equipment.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="default" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                {t("brewery.addProfile")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("brewery.addProfileTitle")}</DialogTitle>
                <DialogDescription>
                  {t("brewery.addProfileDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">{t("brewery.profileName")}</Label>
                  <Input
                    id="profile-name"
                    placeholder={t("brewery.profileNamePlaceholder")}
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
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || isSavingProfile}
                >
                  {t("brewery.addProfile")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {!isBuiltInProfile && currentEquipment && (
            <Button
              variant="destructive"
              size="icon"
              onClick={() => setIsDeleteDialogOpen(true)}
              title={t("brewery.deleteProfileTooltip")}
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
          strikeWater={calculationData.strikeWater}
          spargeWater={calculationData.spargeWater}
          grainVolume={calculationData.grainVolume}
          mashVolume={calculationData.mashVolume}
          mashCapacity={calculationData.mashCapacity}
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
          onMaximumVolumeChange={handleMaximumVolumeChange}
          onNameChange={handleStageNameChange}
          readOnly={isBuiltInProfile}
          volumeUnit={displayVolumeUnit}
        />
      </div>
    </div>
  );
}
