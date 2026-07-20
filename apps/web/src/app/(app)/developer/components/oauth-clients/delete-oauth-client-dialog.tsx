"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import type { DeleteOAuthClientDialogProps } from "./types";

export function DeleteOAuthClientDialog({
  client,
  open,
  onOpenChange,
  onSuccess,
  deleteClient,
}: DeleteOAuthClientDialogProps) {
  const t = useTranslations("App.Developer.OAuthClients");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!client) {
      return;
    }

    setIsDeleting(true);
    try {
      const success = await deleteClient({ clientId: client.client_id });
      if (success) {
        onOpenChange(false);
        onSuccess();
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const clientName = client?.client_name || client?.client_id || "";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("DeleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("DeleteDialog.description", { name: clientName })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("DeleteDialog.cancelButton")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting || !client}
          >
            {isDeleting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {t("DeleteDialog.deleteButton")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
