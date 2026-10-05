"use client";

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
  const t = useTranslations("App.Account.OAuthClients");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDelete = async () => {
    if (!client) {
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await deleteClient({ clientId: client.client_id });
      if (success) {
        onOpenChange(false);
        onSuccess();
      }
    } finally {
      setIsSubmitting(false);
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
          <AlertDialogCancel disabled={isSubmitting}>
            {t("DeleteDialog.cancelButton")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!client}
            loading={isSubmitting}
            onClick={() => void handleDelete()}
          >
            {t("DeleteDialog.deleteButton")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
