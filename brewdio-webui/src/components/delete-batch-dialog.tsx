import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { deleteBatch } from "@/lib/actions/batches";
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
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DeleteBatchDialogProps {
  batchId: string;
  batchName: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  showIcon?: boolean;
  redirectOnDelete?: boolean;
}

export function DeleteBatchDialog({
  batchId,
  batchName,
  variant = "destructive",
  size = "default",
  showIcon = true,
  redirectOnDelete = false,
}: DeleteBatchDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteBatch(batchId);
      setOpen(false);

      // Redirect to home page if requested (e.g., when deleting from batch page)
      if (redirectOnDelete) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete batch:", error);
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
          <AlertDialogDescription>
            {t("batches.deleteConfirmationBefore")} <strong>{batchName}</strong>?{" "}
            {t("batches.deleteConfirmationAfter")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t("batches.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
