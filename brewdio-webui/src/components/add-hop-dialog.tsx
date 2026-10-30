import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useSettings } from "@/lib/db/settings";
import { useRecipeEdit } from "@/contexts/recipe-edit-context";
import type { HopAdditionType, MassUnitType, UseType } from "brewdio-wasm";
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
import { getHops } from "brewdio-wasm";
import { useTranslation } from "react-i18next";

interface AddHopDialogProps {
  existingHop?: HopAdditionType;
  index?: number;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const massUnits: MassUnitType[] = ["mg", "g", "kg", "lb", "oz"];

export function AddHopDialog({
  existingHop,
  index,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: AddHopDialogProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { update } = useRecipeEdit();
  const { data: settings } = useSettings();
  const isEditing = existingHop !== undefined && index !== undefined;

  const form = useForm({
    defaultValues: {
      hopName: existingHop?.name || "",
      amount: existingHop?.amount.value.toString() || "1.0",
      unit: (existingHop?.amount.unit || settings?.defaultMassUnit || "oz") as MassUnitType,
      use: (existingHop?.timing?.use || "add_to_boil") as UseType,
      time: existingHop?.timing?.time?.value.toString() || "60",
      duration: existingHop?.timing?.duration?.value.toString() || "",
    },
    onSubmit: async ({ value }) => {
      // Find the selected hop from the hops data
      const selectedHop = getHops().find((h) => h.name === value.hopName);

      if (!selectedHop) {
        return;
      }

      // Create the hop addition with timing based on use type
      const isBoil = value.use === "add_to_boil";
      const hopAddition: HopAdditionType = {
        name: selectedHop.name,
        origin: selectedHop.origin,
        alpha_acid: selectedHop.alpha_acid,
        beta_acid: selectedHop.beta_acid,
        amount: {
          value: parseFloat(value.amount),
          unit: value.unit,
        },
        timing: {
          use: value.use,
          // For boil: time is boil duration in minutes
          // For fermentation: time is when to add (days into fermentation)
          time: isBoil ? {
            value: parseFloat(value.time),
            unit: "min",
          } : {
            value: parseFloat(value.time),
            unit: "day",
          },
          // Duration only applies to fermentation (how long it stays)
          // Only include if a value is provided (empty string means unlimited)
          ...(!isBoil && value.duration && {
            duration: {
              value: parseFloat(value.duration),
              unit: "day",
            }
          }),
        },
      };

      // Update in the database
      update((draft) => {
        if (isEditing && index !== undefined) {
          // Edit existing hop
          draft.recipe.ingredients.hop_additions =
            draft.recipe.ingredients.hop_additions?.map((item, idx) =>
              idx === index ? hopAddition : item
            ) || [];
        } else {
          // Add new hop
          draft.recipe.ingredients.hop_additions = [
            ...(draft.recipe.ingredients.hop_additions || []),
            hopAddition,
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
              {t("ingredients.hop.add")}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("ingredients.hop.edit") : t("ingredients.hop.add")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("ingredients.hop.editDescription")
              : t("ingredients.hop.addDescription")}
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
            name="hopName"
            validators={{
              onChange: ({ value }) =>
                !value ? t("ingredients.hop.selectionRequired") : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("ingredients.hop.variety")}</Label>
                <Combobox
                  options={getHops().map((h) => ({
                    value: h.name,
                    label: `${h.name} (${h.origin})`,
                  }))}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  placeholder={t("ingredients.hop.select")}
                  searchPlaceholder={t("ingredients.hop.search")}
                  emptyText={t("ingredients.hop.notFound")}
                />
                {field.state.meta.errors && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="use">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("ingredients.hop.additionType")}</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(newValue) => {
                    field.handleChange(newValue as typeof field.state.value);

                    // Reset time field to sensible defaults when switching types
                    const currentTime = form.getFieldValue("time");
                    const timeNum = currentTime ? parseFloat(currentTime) : 0;

                    // If switching to fermentation and time is a typical boil value, reset to 3 days
                    if (newValue === "add_to_fermentation" && timeNum >= 30) {
                      form.setFieldValue("time", "3");
                    }
                    // If switching to boil and time is a typical fermentation value, reset to 60 min
                    else if (newValue === "add_to_boil" && timeNum <= 10) {
                      form.setFieldValue("time", "60");
                    }
                  }}
                >
                  <SelectTrigger id={field.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add_to_boil">{t("ingredients.hop.boil")}</SelectItem>
                    <SelectItem value="add_to_fermentation">
                      {t("ingredients.hop.fermentationDryHop")}
                    </SelectItem>
                  </SelectContent>
                </Select>
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
                    step="0.01"
                    min="0.01"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="1.0"
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
                      {massUnits.map((unit) => (
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

          <form.Subscribe selector={(state) => state.values.use}>
            {(useType) => {
              const isBoil = useType === "add_to_boil";
              return (
                <>
                  <form.Field
                    name="time"
                    validators={{
                      onChange: ({ value }) => {
                        const num = parseFloat(value);
                        if (isNaN(num) || num < 0) {
                          return t("ingredients.hop.timeNonNegative");
                        }
                        return undefined;
                      },
                    }}
                  >
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>
                          {isBoil
                            ? t("ingredients.hop.boilTimeMinutes")
                            : t("ingredients.hop.addAfterDays")}
                        </Label>
                        <Input
                          id={field.name}
                          type="number"
                          step={isBoil ? "1" : "0.5"}
                          min="0"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder={isBoil ? "60" : "3"}
                        />
                        {!isBoil && (
                          <p className="text-xs text-muted-foreground">
                            {t("ingredients.hop.daysIntoFermentation")}
                          </p>
                        )}
                        {field.state.meta.errors && (
                          <p className="text-sm text-destructive">
                            {field.state.meta.errors.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  {!isBoil && (
                    <form.Field
                      name="duration"
                      validators={{
                        onChange: ({ value }) => {
                          // Allow empty string (unlimited duration)
                          if (value === "") {
                            return undefined;
                          }
                          const num = parseFloat(value);
                          if (isNaN(num) || num <= 0) {
                            return t("ingredients.hop.durationPositiveOrEmpty");
                          }
                          return undefined;
                        },
                      }}
                    >
                      {(field) => (
                        <div className="space-y-2">
                          <Label htmlFor={field.name}>
                            {t("ingredients.hop.durationOptional")}
                          </Label>
                          <Input
                            id={field.name}
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder={t("ingredients.hop.unlimitedPlaceholder")}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t("ingredients.hop.durationHelp")}
                          </p>
                          {field.state.meta.errors && (
                            <p className="text-sm text-destructive">
                              {field.state.meta.errors.join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                  )}
                </>
              );
            }}
          </form.Subscribe>

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
                    ? t("ingredients.hop.update")
                    : t("ingredients.hop.add")}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
