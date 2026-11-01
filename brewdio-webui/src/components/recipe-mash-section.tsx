import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getMashProfiles } from "brewdio-wasm";
import { useRecipeEdit } from "@/contexts/recipe-edit-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
import { InlineField } from "@/components/inline-field";
import { InlineTemperature } from "@/components/inline-temperature";
import { Pencil, Trash2, Plus, ArrowLeftRight } from "lucide-react";
import type { MashStepType, TemperatureType } from "brewdio-wasm";

const MASH_STEP_TYPES = [
  { value: "infusion", labelKey: "mash.stepTypes.infusion" },
  { value: "temperature", labelKey: "mash.stepTypes.temperature" },
  { value: "decoction", labelKey: "mash.stepTypes.decoction" },
  { value: "souring mash", labelKey: "mash.stepTypes.souringMash" },
  { value: "souring wort", labelKey: "mash.stepTypes.souringWort" },
  { value: "drain mash tun", labelKey: "mash.stepTypes.drainMashTun" },
  { value: "sparge", labelKey: "mash.stepTypes.sparge" },
];

const STANDARD_MASH_TEXT_KEYS: Record<string, string> = {
  "Single Infusion (F)": "mash.builtIn.singleInfusionF",
  "Single Infusion (C)": "mash.builtIn.singleInfusionC",
  "Enkel infusjon (F)": "mash.builtIn.singleInfusionF",
  "Enkel infusjon (C)": "mash.builtIn.singleInfusionC",
  "Standard single infusion mash for most beer styles": "mash.builtIn.standardNotes",
  "Standard enkel infusjonsmesking for de fleste ølstiler": "mash.builtIn.standardNotes",
  Saccharification: "mash.builtIn.saccharification",
  Sukkerkonvertering: "mash.builtIn.saccharification",
  "Mash Out": "mash.builtIn.mashOut",
  Utmesking: "mash.builtIn.mashOut",
  "Convert starches to fermentable sugars": "mash.builtIn.saccharificationDescription",
  "Konverter stivelse til gjærbart sukker": "mash.builtIn.saccharificationDescription",
  "Stop enzyme activity and improve lautering": "mash.builtIn.mashOutDescription",
  "Stopp enzymaktiviteten og gjør silingen enklere": "mash.builtIn.mashOutDescription",
};

function translateStandardMashText(value: string, t: TFunction): string {
  const key = STANDARD_MASH_TEXT_KEYS[value];
  return key ? t(key) : value;
}

function getStepTypeLabel(type: string, t: TFunction): string {
  const stepType = MASH_STEP_TYPES.find((item) => item.value === type);
  return stepType ? t(stepType.labelKey) : type;
}

function newDefaultStep(name: string): MashStepType {
  return {
    name,
    type: "infusion",
    step_temperature: { value: 152, unit: "F" },
    step_time: { value: 60, unit: "min" },
  };
}

export function RecipeMashSection() {
  const { t } = useTranslation();
  const { update, document: recipe } = useRecipeEdit();
  const mashProfiles = useMemo(() => {
    const profiles = getMashProfiles();
    return profiles.map((p) => ({
      id: p.name.toLowerCase().replace(/\s+/g, "-"),
      mashProfile: p,
    }));
  }, []);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [switchProfileOpen, setSwitchProfileOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

  // Step editing
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editStepIndex, setEditStepIndex] = useState<number | null>(null);
  const [stepForm, setStepForm] = useState<MashStepType>(() =>
    newDefaultStep(t("mash.newStep"))
  );

  if (!recipe) return <div>{t("mash.loading")}</div>;

  const mash = recipe.recipe.mash;

  // --- Immediate update handlers ---
  const handleUpdateName = (name: string) => {
    update((draft) => {
      if (draft.recipe.mash) draft.recipe.mash.name = name;
    });
    setEditingField(null);
  };

  const handleUpdateGrainTemp = (temp: TemperatureType) => {
    update((draft) => {
      if (draft.recipe.mash) draft.recipe.mash.grain_temperature = temp;
    });
    setEditingField(null);
  };

  const handleUpdateNotes = (notes: string) => {
    update((draft) => {
      if (draft.recipe.mash) draft.recipe.mash.notes = notes || undefined;
    });
    setEditingField(null);
  };

  // --- Switch Profile ---
  const handleConfirmSwitchProfile = () => {
    const profile = mashProfiles.find((p) => p.id === selectedProfileId);
    if (!profile) return;
    update((draft) => {
      draft.recipe.mash = structuredClone(profile.mashProfile);
    });
    setSwitchProfileOpen(false);
    setSelectedProfileId("");
  };

  // --- Step CRUD ---
  const handleOpenAddStep = () => {
    setEditStepIndex(null);
    setStepForm(newDefaultStep(t("mash.newStep")));
    setStepDialogOpen(true);
  };

  const handleOpenEditStep = (idx: number) => {
    if (!mash) return;
    setEditStepIndex(idx);
    const localizedStep = structuredClone(mash.mash_steps[idx]);
    localizedStep.name = translateStandardMashText(localizedStep.name, t);
    if (localizedStep.description) {
      localizedStep.description = translateStandardMashText(
        localizedStep.description,
        t
      );
    }
    setStepForm(localizedStep);
    setStepDialogOpen(true);
  };

  const handleSaveStep = () => {
    update((draft) => {
      if (!draft.recipe.mash) return;
      if (editStepIndex !== null) {
        draft.recipe.mash.mash_steps[editStepIndex] = structuredClone(stepForm);
      } else {
        draft.recipe.mash.mash_steps.push(structuredClone(stepForm));
      }
    });
    setStepDialogOpen(false);
  };

  const handleRemoveStep = (idx: number) => {
    update((draft) => {
      if (draft.recipe.mash) {
        draft.recipe.mash.mash_steps = draft.recipe.mash.mash_steps.filter(
          (_, i) => i !== idx
        );
      }
    });
  };

  // --- No mash state ---
  if (!mash) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{t("mash.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("mash.noProcedure")}
        </p>
        {mashProfiles.length > 0 && (
          <div className="space-y-2">
            <Label>{t("mash.selectProfilePrompt")}</Label>
            <Select
              onValueChange={(profileId) => {
                const profile = mashProfiles.find((p) => p.id === profileId);
                if (profile) {
                  update((draft) => {
                    draft.recipe.mash = structuredClone(profile.mashProfile);
                  });
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("mash.chooseProfile")} />
              </SelectTrigger>
              <SelectContent>
                {mashProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {translateStandardMashText(profile.mashProfile.name, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t("mash.title")}</h2>
        {mashProfiles.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSwitchProfileOpen(true)}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" />
            {t("mash.switchProfile")}
          </Button>
        )}
      </div>

      {/* Compact Mash Info */}
      <div className="space-y-1">
        <InlineField
          label={t("mash.name")}
          value={translateStandardMashText(mash.name, t)}
          isEditing={editingField === "name"}
          onEdit={() => setEditingField("name")}
          onSave={handleUpdateName}
          onCancel={() => setEditingField(null)}
        />
        <InlineTemperature
          label={t("mash.grainTemperature")}
          value={mash.grain_temperature}
          isEditing={editingField === "grain_temp"}
          onEdit={() => setEditingField("grain_temp")}
          onSave={handleUpdateGrainTemp}
          onCancel={() => setEditingField(null)}
        />
        <InlineField
          label={t("mash.notes")}
          value={mash.notes ? translateStandardMashText(mash.notes, t) : ""}
          optional
          multiline
          isEditing={editingField === "notes"}
          onEdit={() => setEditingField("notes")}
          onSave={handleUpdateNotes}
          onCancel={() => setEditingField(null)}
        />
      </div>

      {/* Mash Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("mash.steps")}
          </h4>
          <Button variant="outline" size="sm" onClick={handleOpenAddStep}>
            <Plus className="h-4 w-4 mr-1" />
            {t("mash.addStep")}
          </Button>
        </div>
        {mash.mash_steps.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("mash.noSteps")}</p>
        ) : (
          <div className="space-y-2">
            {mash.mash_steps.map((step, idx) => (
              <div
                key={idx}
                className="flex justify-between items-center text-sm border-b pb-2 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {translateStandardMashText(step.name, t)}
                  </span>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {getStepTypeLabel(step.type, t)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    {step.step_temperature.value}&deg;{step.step_temperature.unit}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {step.step_time.value} {step.step_time.unit}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                    onClick={() => handleOpenEditStep(idx)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveStep(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Switch Profile Dialog */}
      <Dialog open={switchProfileOpen} onOpenChange={setSwitchProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mash.switchProfileTitle")}</DialogTitle>
            <DialogDescription>
              {t("mash.switchProfileDescription")}
            </DialogDescription>
          </DialogHeader>
          <Select
            value={selectedProfileId}
            onValueChange={setSelectedProfileId}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("mash.chooseProfile")} />
            </SelectTrigger>
            <SelectContent>
              {mashProfiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {translateStandardMashText(profile.mashProfile.name, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSwitchProfileOpen(false);
                setSelectedProfileId("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleConfirmSwitchProfile}
              disabled={!selectedProfileId}
            >
              {t("mash.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit/Add Step Dialog */}
      <MashStepDialog
        open={stepDialogOpen}
        onOpenChange={setStepDialogOpen}
        step={stepForm}
        onStepChange={setStepForm}
        onSave={handleSaveStep}
        isNew={editStepIndex === null}
      />
    </div>
  );
}

// --- Step Edit/Add Dialog ---

interface MashStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: MashStepType;
  onStepChange: (step: MashStepType) => void;
  onSave: () => void;
  isNew: boolean;
}

function MashStepDialog({
  open,
  onOpenChange,
  step,
  onStepChange,
  onSave,
  isNew,
}: MashStepDialogProps) {
  const { t } = useTranslation();
  const updateField = (field: string, value: any) => {
    onStepChange({ ...step, [field]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isNew ? t("mash.addStepTitle") : t("mash.editStepTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t("mash.name")}</Label>
              <Input
                value={step.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("mash.type")}</Label>
              <Select
                value={step.type}
                onValueChange={(val) => updateField("type", val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MASH_STEP_TYPES.map((stepType) => (
                    <SelectItem key={stepType.value} value={stepType.value}>
                      {t(stepType.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Temperature + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t("mash.temperature")}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={step.step_temperature.value}
                  onChange={(e) =>
                    updateField("step_temperature", {
                      ...step.step_temperature,
                      value: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="flex-1"
                />
                <Select
                  value={step.step_temperature.unit}
                  onValueChange={(val) =>
                    updateField("step_temperature", {
                      ...step.step_temperature,
                      unit: val,
                    })
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">&deg;F</SelectItem>
                    <SelectItem value="C">&deg;C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t("mash.duration")}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={step.step_time.value}
                  onChange={(e) =>
                    updateField("step_time", {
                      ...step.step_time,
                      value: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="flex-1"
                />
                <Select
                  value={step.step_time.unit}
                  onValueChange={(val) =>
                    updateField("step_time", { ...step.step_time, unit: val })
                  }
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="min">min</SelectItem>
                    <SelectItem value="hr">hr</SelectItem>
                    <SelectItem value="sec">sec</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Ramp Time (optional) */}
          <div className="space-y-1">
            <Label className="text-muted-foreground">
              {t("mash.rampTimeOptional")}
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={step.ramp_time?.value ?? ""}
                placeholder="—"
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    const { ramp_time: _, ...rest } = step;
                    onStepChange(rest as MashStepType);
                  } else {
                    updateField("ramp_time", {
                      value: parseFloat(val) || 0,
                      unit: step.ramp_time?.unit ?? "min",
                    });
                  }
                }}
                className="flex-1"
              />
              <Select
                value={step.ramp_time?.unit ?? "min"}
                onValueChange={(val) =>
                  updateField("ramp_time", {
                    value: step.ramp_time?.value ?? 0,
                    unit: val,
                  })
                }
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="min">min</SelectItem>
                  <SelectItem value="hr">hr</SelectItem>
                  <SelectItem value="sec">sec</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description (optional) */}
          <div className="space-y-1">
            <Label className="text-muted-foreground">
              {t("mash.descriptionOptional")}
            </Label>
            <Textarea
              value={step.description ?? ""}
              placeholder={t("mash.stepDescriptionPlaceholder")}
              onChange={(e) =>
                updateField("description", e.target.value || undefined)
              }
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSave}>
            {isNew ? t("mash.addStep") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
