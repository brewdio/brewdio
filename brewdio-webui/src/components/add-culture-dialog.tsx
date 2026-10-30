import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRecipeEdit } from "@/contexts/recipe-edit-context";
import type { CultureAdditionType, UnitUnitType } from "brewdio-wasm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Combobox } from "@/components/ui/combobox";
import { Plus } from "lucide-react";
import { getCultures } from "brewdio-wasm";
import { useTranslation } from "react-i18next";

interface AddCultureDialogProps {
  existingCulture?: CultureAdditionType;
  index?: number;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const unitTypes: UnitUnitType[] = ["1", "unit", "each", "dimensionless", "pkg"];

export function AddCultureDialog({
  existingCulture,
  index,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: AddCultureDialogProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { update } = useRecipeEdit();
  const isEditing = existingCulture !== undefined && index !== undefined;

  const form = useForm({
    defaultValues: {
      cultureName: existingCulture?.name || "",
      amount: existingCulture?.amount?.value.toString() || "1",
      unit: (existingCulture?.amount?.unit || "pkg") as UnitUnitType,
    },
    onSubmit: async ({ value }) => {
      // Find the selected culture from the cultures data
      const selectedCulture = getCultures().find((c) => c.name === value.cultureName);

      if (!selectedCulture) {
        return;
      }

      // Create the culture addition
      const cultureAddition: CultureAdditionType = {
        name: selectedCulture.name,
        type: selectedCulture.type as CultureAdditionType["type"],
        form: selectedCulture.form as CultureAdditionType["form"],
        producer: selectedCulture.producer,
        attenuation: selectedCulture.attenuation_range?.minimum,
        amount: {
          value: parseFloat(value.amount),
          unit: value.unit,
        },
      };

      // Update in the database
      update((draft) => {
        if (isEditing && index !== undefined) {
          // Edit existing culture
          draft.recipe.ingredients.culture_additions =
            draft.recipe.ingredients.culture_additions?.map((item, idx) =>
              idx === index ? cultureAddition : item
            ) || [];
        } else {
          // Add new culture
          draft.recipe.ingredients.culture_additions = [
            ...(draft.recipe.ingredients.culture_additions || []),
            cultureAddition,
          ];
        }
      });

      // Reset form and close dialog
      form.reset();
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          {trigger || (
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              {t("ingredients.culture.add")}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t("ingredients.culture.edit")
              : t("ingredients.culture.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("ingredients.culture.editDescription")
              : t("ingredients.culture.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4 py-4"
        >
          <form.Field
            name="cultureName"
            validators={{
              onChange: ({ value }) =>
                !value ? t("ingredients.culture.selectionRequired") : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("ingredients.culture.label")}</Label>
                <Combobox
                  options={getCultures().map((c) => ({
                    value: c.name,
                    label: `${c.name} (${c.type})`,
                  }))}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  placeholder={t("ingredients.culture.select")}
                  searchPlaceholder={t("ingredients.culture.search")}
                  emptyText={t("ingredients.culture.notFound")}
                />
                {field.state.meta.errors && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-4">
            <form.Field
              name="amount"
              validators={{
                onChange: ({ value }) => {
                  const num = parseFloat(value);
                  if (isNaN(num) || num <= 0) {
                    return t("ingredients.amountPositive");
                  }
                  return undefined;
                },
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t("common.amount")}</Label>
                  <Input
                    id={field.name}
                    type="number"
                    step="1"
                    min="1"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="1"
                  />
                  {field.state.meta.errors && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="unit">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t("common.unit")}</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {unitTypes.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting
                    ? isEditing
                      ? t("common.updating")
                      : t("common.adding")
                    : isEditing
                    ? t("ingredients.culture.update")
                    : t("ingredients.culture.add")}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
