import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  FlaskConical,
  Leaf,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Wheat,
} from "lucide-react";
import {
  getCultures,
  getFermentables,
  getHops,
  type CultureInformation,
  type FermentableType,
  type HopVarietyBase,
  type InventoryIngredient,
  type InventoryItem,
  type InventoryQuantity,
  type MassUnitType,
  type UnitUnitType,
} from "brewdio-wasm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
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
import {
  createInventoryItemImperative,
  deleteInventoryItemImperative,
  invalidateInventoryItems,
  updateInventoryItemImperative,
  useInventoryItems,
} from "@/lib/db/inventory";
import { useSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventory")({
  component: InventoryComponent,
});

type InventoryCategory = "fermentable" | "hop" | "culture";
type SourceMode = "built_in" | "custom";

const massUnits: MassUnitType[] = ["mg", "g", "kg", "lb", "oz"];
const unitTypes: UnitUnitType[] = ["1", "unit", "each", "dimensionless", "pkg"];

const categoryIcons = {
  fermentable: Wheat,
  hop: Leaf,
  culture: FlaskConical,
};

function ingredientName(item: InventoryItem) {
  return item.ingredient.data.name;
}

function ingredientProducer(item: InventoryItem) {
  return item.ingredient.data.producer || "";
}

function quantityValue(quantity: InventoryQuantity) {
  return quantity.data.value;
}

function quantityUnit(quantity: InventoryQuantity) {
  return quantity.data.unit;
}

function isLowStock(item: InventoryItem) {
  const threshold = item.lowStockThreshold;
  if (!threshold || threshold.kind !== item.quantity.kind) return false;
  if (quantityUnit(threshold) !== quantityUnit(item.quantity)) return false;
  return quantityValue(item.quantity) <= quantityValue(threshold);
}

function formatQuantity(quantity: InventoryQuantity) {
  return `${quantityValue(quantity).toLocaleString()} ${quantityUnit(quantity)}`;
}

function InventoryComponent() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { data: items = [], status } = useInventoryItems();
  const [category, setCategory] = useState<InventoryCategory>("fermentable");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      fermentable: items.filter((item) => item.ingredient.kind === "fermentable").length,
      hop: items.filter((item) => item.ingredient.kind === "hop").length,
      culture: items.filter((item) => item.ingredient.kind === "culture").length,
    }),
    [items]
  );

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (item.ingredient.kind !== category) return false;
      if (!normalizedSearch) return true;
      return [ingredientName(item), ingredientProducer(item), item.location, item.lotNumber]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedSearch));
    });
  }, [category, items, search]);

  const openCreateDialog = () => {
    setEditingItem(null);
    setErrorKey(null);
    setDialogOpen(true);
  };

  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item);
    setErrorKey(null);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setIsDeleting(true);
    setErrorKey(null);
    try {
      await deleteInventoryItemImperative(deletingItem.id);
      await invalidateInventoryItems(queryClient);
      setDeletingItem(null);
    } catch {
      setErrorKey("inventory.errors.delete");
    } finally {
      setIsDeleting(false);
    }
  };

  const categories: InventoryCategory[] = ["fermentable", "hop", "culture"];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <Boxes className="size-8" />
            {t("inventory.title")}
          </h1>
          <p className="mt-2 text-muted-foreground">{t("inventory.description")}</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="size-4" />
          {t("inventory.add")}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label={t("inventory.categoriesLabel")}
        className="grid grid-cols-3 rounded-lg border bg-muted/40 p-1"
      >
        {categories.map((itemCategory) => {
          const Icon = categoryIcons[itemCategory];
          return (
            <Button
              key={itemCategory}
              type="button"
              role="tab"
              aria-label={t(`inventory.categories.${itemCategory}`)}
              aria-selected={category === itemCategory}
              variant={category === itemCategory ? "secondary" : "ghost"}
              className={cn("gap-2", category === itemCategory && "bg-background shadow-sm")}
              onClick={() => setCategory(itemCategory)}
            >
              <Icon className="size-4" />
              <span className="text-xs sm:text-sm">
                {t(`inventory.categories.${itemCategory}`)}
              </span>
              <Badge variant="outline">{counts[itemCategory]}</Badge>
            </Button>
          );
        })}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("inventory.searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {errorKey && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {t(errorKey)}
        </div>
      )}

      {status === "pending" ? (
        <p className="text-muted-foreground">{t("inventory.loading")}</p>
      ) : visibleItems.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Boxes className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{t("inventory.emptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("inventory.emptyDescription")}</p>
            </div>
            <Button variant="outline" onClick={openCreateDialog} className="gap-2">
              <Plus className="size-4" />
              {t("inventory.add")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => {
            const lowStock = isLowStock(item);
            const bestBefore = item.bestBefore
              ? new Intl.DateTimeFormat(i18n.language).format(
                  new Date(`${item.bestBefore}T00:00:00`)
                )
              : null;
            return (
              <Card key={item.id} className={cn(lowStock && "border-amber-500/60")}>
                <CardHeader>
                  <CardTitle className="pr-16">{ingredientName(item)}</CardTitle>
                  <CardDescription>
                    {ingredientProducer(item) || t("inventory.noProducer")}
                  </CardDescription>
                  <CardAction className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("inventory.edit")}
                      onClick={() => openEditDialog(item)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() => setDeletingItem(item)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("inventory.inStock")}
                      </p>
                      <p className="text-2xl font-semibold">{formatQuantity(item.quantity)}</p>
                    </div>
                    <Badge variant={item.source === "custom" ? "secondary" : "outline"}>
                      {t(`inventory.sources.${item.source}`)}
                    </Badge>
                  </div>
                  {lowStock && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                      <TriangleAlert className="size-4" />
                      {t("inventory.lowStock")}
                    </div>
                  )}
                  {item.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="size-4" />
                      {item.location}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {item.lotNumber && (
                      <div>
                        <p className="text-xs text-muted-foreground">{t("inventory.lotNumber")}</p>
                        <p>{item.lotNumber}</p>
                      </div>
                    )}
                    {bestBefore && (
                      <div>
                        <p className="text-xs text-muted-foreground">{t("inventory.bestBefore")}</p>
                        <p>{bestBefore}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <InventoryItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editingItem?.ingredient.kind ?? category}
        item={editingItem}
        defaultMassUnit={(settings?.defaultMassUnit ?? "kg") as MassUnitType}
        onSaved={async () => {
          await invalidateInventoryItems(queryClient);
          setDialogOpen(false);
          setEditingItem(null);
        }}
      />

      <AlertDialog
        open={deletingItem !== null}
        onOpenChange={(open) => !open && setDeletingItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inventory.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("inventory.deleteDescription", {
                name: deletingItem ? ingredientName(deletingItem) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={isDeleting} onClick={handleDelete}>
              {isDeleting ? t("inventory.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface InventoryItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: InventoryCategory;
  item: InventoryItem | null;
  defaultMassUnit: MassUnitType;
  onSaved: () => Promise<void>;
}

function InventoryItemDialog({
  open,
  onOpenChange,
  category,
  item,
  defaultMassUnit,
  onSaved,
}: InventoryItemDialogProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState<SourceMode>("built_in");
  const [selectedName, setSelectedName] = useState("");
  const [customName, setCustomName] = useState("");
  const [producer, setProducer] = useState("");
  const [amount, setAmount] = useState("0");
  const [unit, setUnit] = useState<string>(defaultMassUnit);
  const [threshold, setThreshold] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [colorEbc, setColorEbc] = useState("25");
  const [yieldPercent, setYieldPercent] = useState("75");
  const [alphaAcid, setAlphaAcid] = useState("5");
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const builtInIngredients = useMemo(() => {
    switch (category) {
      case "fermentable":
        return getFermentables();
      case "hop":
        return getHops();
      case "culture":
        return getCultures();
    }
  }, [category]);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setSource(item.source);
      setSelectedName(item.source === "built_in" ? ingredientName(item) : "");
      setCustomName(item.source === "custom" ? ingredientName(item) : "");
      setProducer(ingredientProducer(item));
      setAmount(String(quantityValue(item.quantity)));
      setUnit(String(quantityUnit(item.quantity)));
      setThreshold(
        item.lowStockThreshold ? String(quantityValue(item.lowStockThreshold)) : ""
      );
      setLotNumber(item.lotNumber ?? "");
      setBestBefore(item.bestBefore ?? "");
      setLocation(item.location ?? "");
      setNotes(item.notes ?? "");
      if (item.ingredient.kind === "fermentable") {
        setColorEbc(String(item.ingredient.data.color.value));
        setYieldPercent(
          String(item.ingredient.data.yield.fine_grind?.value ?? 75)
        );
      } else if (item.ingredient.kind === "hop") {
        setAlphaAcid(String(item.ingredient.data.alpha_acid.value));
      }
    } else {
      setSource("built_in");
      setSelectedName("");
      setCustomName("");
      setProducer("");
      setAmount("0");
      setUnit(category === "culture" ? "pkg" : defaultMassUnit);
      setThreshold("");
      setLotNumber("");
      setBestBefore("");
      setLocation("");
      setNotes("");
      setColorEbc("25");
      setYieldPercent("75");
      setAlphaAcid("5");
    }
    setErrorKey(null);
  }, [category, defaultMassUnit, item, open]);

  const ingredientOptions = builtInIngredients.map((ingredient) => ({
    value: ingredient.name,
    label: ingredient.producer
      ? `${ingredient.name} – ${ingredient.producer}`
      : ingredient.name,
  }));

  const buildIngredient = (): InventoryIngredient | null => {
    if (source === "built_in") {
      const selected = builtInIngredients.find((ingredient) => ingredient.name === selectedName);
      if (!selected) return null;
      if (category === "fermentable") {
        return { kind: "fermentable", data: selected as FermentableType };
      }
      if (category === "hop") {
        return { kind: "hop", data: selected as HopVarietyBase };
      }
      return { kind: "culture", data: selected as CultureInformation };
    }

    const name = customName.trim();
    if (!name) return null;
    if (category === "fermentable") {
      return {
        kind: "fermentable",
        data: {
          name,
          producer: producer.trim() || undefined,
          type: "grain",
          color: { unit: "EBC", value: Number(colorEbc) },
          yield: {
            fine_grind: { unit: "%", value: Number(yieldPercent) },
          },
        },
      };
    }
    if (category === "hop") {
      return {
        kind: "hop",
        data: {
          name,
          producer: producer.trim() || undefined,
          form: "pellet",
          alpha_acid: { unit: "%", value: Number(alphaAcid) },
        },
      };
    }
    return {
      kind: "culture",
      data: {
        name,
        producer: producer.trim() || undefined,
        type: "ale",
        form: "dry",
      },
    };
  };

  const buildQuantity = (value: number): InventoryQuantity => {
    if (category === "culture") {
      return {
        kind: "unit",
        data: { value, unit: unit as UnitUnitType },
      };
    }
    return {
      kind: "mass",
      data: { value, unit: unit as MassUnitType },
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ingredient = buildIngredient();
    const numericAmount = Number(amount);
    const numericThreshold = threshold === "" ? null : Number(threshold);
    if (!ingredient) {
      setErrorKey("inventory.errors.ingredientRequired");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      setErrorKey("inventory.errors.amountInvalid");
      return;
    }
    if (numericThreshold !== null && (!Number.isFinite(numericThreshold) || numericThreshold < 0)) {
      setErrorKey("inventory.errors.thresholdInvalid");
      return;
    }

    setIsSaving(true);
    setErrorKey(null);
    const now = new Date().toISOString();
    const inventoryItem: InventoryItem = {
      id: item?.id ?? "",
      ingredient,
      source,
      quantity: buildQuantity(numericAmount),
      lowStockThreshold:
        numericThreshold === null ? undefined : buildQuantity(numericThreshold),
      lotNumber: lotNumber.trim() || undefined,
      bestBefore: bestBefore || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: item?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      if (item) {
        await updateInventoryItemImperative(item.id, inventoryItem);
      } else {
        await createInventoryItemImperative(inventoryItem);
      }
      await onSaved();
    } catch {
      setErrorKey("inventory.errors.save");
    } finally {
      setIsSaving(false);
    }
  };

  const availableUnits = category === "culture" ? unitTypes : massUnits;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? t("inventory.editTitle") : t("inventory.addTitle")}</DialogTitle>
          <DialogDescription>{t("inventory.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={source === "built_in" ? "secondary" : "outline"}
              onClick={() => setSource("built_in")}
            >
              {t("inventory.useBuiltIn")}
            </Button>
            <Button
              type="button"
              variant={source === "custom" ? "secondary" : "outline"}
              onClick={() => setSource("custom")}
            >
              {t("inventory.createCustom")}
            </Button>
          </div>

          {source === "built_in" ? (
            <div className="space-y-2">
              <Label>{t("inventory.ingredient")}</Label>
              <Combobox
                options={ingredientOptions}
                value={selectedName}
                onValueChange={setSelectedName}
                placeholder={t("inventory.selectIngredient")}
                searchPlaceholder={t("inventory.searchIngredients")}
                emptyText={t("inventory.noIngredientFound")}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inventory-name">{t("inventory.name")}</Label>
                <Input
                  id="inventory-name"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-producer">{t("inventory.producer")}</Label>
                <Input
                  id="inventory-producer"
                  value={producer}
                  onChange={(event) => setProducer(event.target.value)}
                />
              </div>
              {category === "fermentable" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="inventory-color">{t("inventory.colorEbc")}</Label>
                    <Input
                      id="inventory-color"
                      type="number"
                      min="0"
                      step="0.1"
                      value={colorEbc}
                      onChange={(event) => setColorEbc(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inventory-yield">{t("inventory.yieldPercent")}</Label>
                    <Input
                      id="inventory-yield"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={yieldPercent}
                      onChange={(event) => setYieldPercent(event.target.value)}
                    />
                  </div>
                </>
              )}
              {category === "hop" && (
                <div className="space-y-2">
                  <Label htmlFor="inventory-alpha">{t("inventory.alphaAcid")}</Label>
                  <Input
                    id="inventory-alpha"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={alphaAcid}
                    onChange={(event) => setAlphaAcid(event.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="inventory-amount">{t("inventory.inStock")}</Label>
              <Input
                id="inventory-amount"
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("common.unit")}</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableUnits.map((availableUnit) => (
                    <SelectItem key={availableUnit} value={availableUnit}>
                      {availableUnit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-threshold">{t("inventory.lowStockThreshold")}</Label>
              <Input
                id="inventory-threshold"
                type="number"
                min="0"
                step="any"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                placeholder={t("inventory.optional")}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="inventory-lot">{t("inventory.lotNumber")}</Label>
              <Input
                id="inventory-lot"
                value={lotNumber}
                onChange={(event) => setLotNumber(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-best-before">{t("inventory.bestBefore")}</Label>
              <Input
                id="inventory-best-before"
                type="date"
                value={bestBefore}
                onChange={(event) => setBestBefore(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-location">{t("inventory.location")}</Label>
              <Input
                id="inventory-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inventory-notes">{t("inventory.notes")}</Label>
            <Textarea
              id="inventory-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {errorKey && <p className="text-sm text-destructive">{t(errorKey)}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? t("inventory.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
