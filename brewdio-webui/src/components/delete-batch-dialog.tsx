import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { deleteBatch } from "@/lib/actions/batches";
import { batchKeys } from "@/lib/db/batches";
import { inventoryKeys } from "@/lib/db/inventory";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PackageCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { InventoryDeduction, InventoryQuantity } from "brewdio-wasm";

interface DeleteBatchDialogProps {
  batchId: string;
  batchName: string;
  inventoryDeductions?: InventoryDeduction[];
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  showIcon?: boolean;
  redirectOnDelete?: boolean;
}

export function DeleteBatchDialog({
  batchId,
  batchName,
  inventoryDeductions = [],
  variant = "destructive",
  size = "default",
  showIcon = true,
  redirectOnDelete = false,
}: DeleteBatchDialogProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnsInventory = inventoryDeductions.length > 0;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteBatch(batchId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: batchKeys.all }),
        queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
      ]);
      setOpen(false);

      toast.success(
        t(returnsInventory ? "batches.deleteSuccessRestored" : "batches.deleteSuccess")
      );

      // Redirect to home page if requested (e.g., when deleting from batch page)
      if (redirectOnDelete) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete batch:", error);
      toast.error(t("batches.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size}>
          {showIcon && <Trash2 className="h-4 w-4" />}
          {size !== "icon" && (showIcon ? <span className="ml-2">{t("common.delete")}</span> : t("common.delete"))}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("batches.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                {t("batches.deleteConfirmationBefore")} <strong>{batchName}</strong>?
              </p>
              {returnsInventory ? (
                <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-foreground">
                  <div className="flex items-center gap-2 font-medium">
                    <PackageCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span>{t("batches.inventory.deleteReturnTitle")}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("batches.inventory.deleteReturnDescription")}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {inventoryDeductions.map((deduction, index) => (
                      <li
                        key={`${deduction.inventoryItemId}-${index}`}
                        className="flex justify-between gap-4"
                      >
                        <span>{deduction.ingredientName}</span>
                        <span className="font-medium tabular-nums">
                          {formatQuantity(
                            deduction.quantity,
                            i18n.resolvedLanguage?.startsWith("nb") ? "nb-NO" : "en-US"
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    {t("batches.inventory.deleteAtomicHelp")}
                  </p>
                </div>
              ) : (
                <p>{t("batches.deleteConfirmationAfter")}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting
              ? t("batches.deleting")
              : returnsInventory
                ? t("batches.inventory.deleteAndRestore")
                : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatQuantity(quantity: InventoryQuantity, locale: string) {
  return `${quantity.data.value.toLocaleString(locale)} ${quantity.data.unit}`;
}
