import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useSettings } from "@/lib/db/settings";
import { createRecipe, getAvailableStyles } from "@/lib/actions/recipes";
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
import { Combobox } from "@/components/ui/combobox";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CreateRecipeDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateRecipeDialog({ open: controlledOpen, onOpenChange }: CreateRecipeDialogProps = {}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const availableStyles = getAvailableStyles();
  const batchSizeUnit = settings?.defaultVolumeUnit ?? "gal";

  const form = useForm({
    defaultValues: {
      name: "",
      batchSize: "5.0",
      styleName: "",
    },
    onSubmit: async ({ value }) => {
      try {
        const recipeId = await createRecipe({
          name: value.name,
          batchSize: parseFloat(value.batchSize),
          batchSizeUnit,
          styleName: value.styleName,
          author: settings?.defaultAuthor || "Brewdio User",
        });

        // Reset form and close dialog
        form.reset();
        setOpen(false);

        // Navigate to the new recipe
        navigate({ to: "/recipes/$recipeId", params: { recipeId } });
      } catch (error) {
        console.error("Failed to create recipe:", error);
        // You could add error handling UI here
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {t("recipes.createAction")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("recipes.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("recipes.createDescription")}
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
            name="name"
            validators={{
              onChange: ({ value }) =>
                !value ? t("recipes.nameRequired") : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("recipes.nameLabel")}</Label>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("recipes.namePlaceholder")}
                />
                {field.state.meta.errors && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="batchSize"
            validators={{
              onChange: ({ value }) => {
                const num = parseFloat(value);
                if (isNaN(num) || num <= 0) {
                  return t("recipes.batchSizePositive");
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>
                  {t("recipes.batchSizeWithUnitLabel", { unit: batchSizeUnit })}
                </Label>
                <Input
                  id={field.name}
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="5.0"
                />
                {field.state.meta.errors && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="styleName"
            validators={{
              onChange: ({ value }) =>
                !value ? t("recipes.styleRequired") : undefined,
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t("recipes.beerStyleLabel")}</Label>
                <Combobox
                  options={availableStyles.map((s) => ({
                    value: s.name,
                    label: `${s.name} - ${s.category}`,
                  }))}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  placeholder={t("recipes.selectStyle")}
                  searchPlaceholder={t("recipes.searchStyles")}
                  emptyText={t("recipes.noStyleFound")}
                />
                {field.state.meta.errors && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors.join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

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
                  {isSubmitting ? t("recipes.creating") : t("recipes.createAction")}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
