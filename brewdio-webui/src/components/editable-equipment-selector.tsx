import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { EquipmentProfile, EquipmentType } from "brewdio-wasm";
import { useTranslation } from "react-i18next";
import { useEquipmentProfiles } from "@/lib/db/equipment";

const NONE_VALUE = "__none__";

interface EditableEquipmentSelectorProps {
  equipment?: EquipmentType | null;
  onSave: (profile: EquipmentProfile | null) => void | Promise<void>;
  className?: string;
}

export function EditableEquipmentSelector({
  equipment,
  onSave,
  className,
}: EditableEquipmentSelectorProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [selectedName, setSelectedName] = useState(equipment?.name ?? NONE_VALUE);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<EquipmentProfile | null>(null);

  const { data: profiles = [] } = useEquipmentProfiles();

  const handleSave = async () => {
    const currentName = equipment?.name ?? NONE_VALUE;
    if (selectedName === currentName) {
      setIsEditing(false);
      return;
    }

    if (selectedName === NONE_VALUE) {
      setIsSaving(true);
      try {
        await onSave(null);
        setIsEditing(false);
      } catch (error) {
        console.error("Failed to save equipment:", error);
        setSelectedName(equipment?.name ?? NONE_VALUE);
      } finally {
        setIsSaving(false);
      }
    } else {
      const selected = profiles.find((p) => p.equipment.name === selectedName);
      if (selected) {
        // Show confirmation dialog about efficiency overwrite
        setPendingProfile(selected);
      }
    }
  };

  const handleConfirm = async () => {
    if (!pendingProfile) return;
    setIsSaving(true);
    try {
      await onSave(pendingProfile);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save equipment:", error);
      setSelectedName(equipment?.name ?? NONE_VALUE);
    } finally {
      setIsSaving(false);
      setPendingProfile(null);
    }
  };

  const handleCancelConfirm = () => {
    setPendingProfile(null);
    setSelectedName(equipment?.name ?? NONE_VALUE);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setSelectedName(equipment?.name ?? NONE_VALUE);
    setIsEditing(false);
  };

  return (
    <>
      {isEditing ? (
        <div className={cn("flex items-center gap-2", className)}>
          <Select value={selectedName} onValueChange={setSelectedName}>
            <SelectTrigger className="h-7 text-xs w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>{t("equipment.none")}</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.equipment.name} value={p.equipment.name}>
                  {p.equipment.name} ({p.efficiency.brewhouse.value}%)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSave();
            }}
            disabled={isSaving}
            className="h-6 w-6 p-0 shrink-0 text-green-600 hover:text-green-700 hover:bg-green-50"
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCancel();
            }}
            disabled={isSaving}
            className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className={cn("flex items-center gap-1 group", className)}>
          <p className="text-xs text-muted-foreground/70">
            {equipment?.name ?? t("equipment.none")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
          >
            <Pencil className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      <AlertDialog open={!!pendingProfile} onOpenChange={(open) => { if (!open) handleCancelConfirm(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("equipment.changeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("equipment.changeDescriptionBefore")}{" "}
              <strong>{pendingProfile?.efficiency.brewhouse.value}%</strong>,
              {" "}{t("equipment.changeDescriptionAfter")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {t("common.continue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
