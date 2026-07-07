"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { deleteAdminInvoiceAction } from "@/lib/actions/invoice-admin/action";
import type { InvoiceStatus } from "@/lib/services/invoice-admin.service";

interface InvoiceDeleteButtonProps {
  invoiceId: string;
  status: InvoiceStatus | null;
  variant?: "outline" | "destructive";
  size?: "default" | "sm";
  onDeleted?: () => void;
  redirectToList?: boolean;
}

function isDeletableStatus(status: InvoiceStatus | null): boolean {
  return status === "draft" || status === "open";
}

export function InvoiceDeleteButton({
  invoiceId,
  status,
  variant = "outline",
  size = "sm",
  onDeleted,
  redirectToList = false,
}: InvoiceDeleteButtonProps) {
  const t = useTranslations("App.Admin.Invoices");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isDeletableStatus(status)) {
    return null;
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const result = await deleteAdminInvoiceAction({ invoiceId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("deleteError"));
        return;
      }
      toast.success(t("deleteSuccess"));
      setIsOpen(false);
      onDeleted?.();
      if (redirectToList) {
        router.push("/admin/invoices");
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={isDeleting}>
          {isDeleting ? t("deleting") : t("delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t("deleting") : t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
