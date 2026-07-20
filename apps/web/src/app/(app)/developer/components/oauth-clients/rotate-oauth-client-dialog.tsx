"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ClientSecretField } from "./client-secret-field";
import type { RotateOAuthClientDialogProps } from "./types";

export function RotateOAuthClientDialog({
  client,
  open,
  onOpenChange,
  onSuccess,
  rotateSecret,
}: RotateOAuthClientDialogProps) {
  const t = useTranslations("App.Account.OAuthClients");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  const showingCredentials = rotatedSecret !== null;
  const clientName = client?.client_name || client?.client_id || "";

  const handleConfirmOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const handleRotate = async () => {
    if (!client) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await rotateSecret({ clientId: client.client_id });
      if (result.success && result.data?.clientSecret) {
        setRotatedSecret(result.data.clientSecret);
        onSuccess?.();
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCredentialsOpenChange = (nextOpen: boolean) => {
    // One-time secret must only dismiss via Done.
    if (!nextOpen && showingCredentials) {
      return;
    }
  };

  const handleCredentialsDone = () => {
    setRotatedSecret(null);
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copySuccess"));
    } catch {
      toast.error(t("Messages.copyError"));
    }
  };

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("RotateDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("RotateDialog.description", { name: clientName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {t("RotateDialog.cancelButton")}
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={isSubmitting || !client}
              onClick={() => void handleRotate()}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {t("RotateDialog.confirmButton")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showingCredentials}
        onOpenChange={handleCredentialsOpenChange}
      >
        <DialogContent
          className="[&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("RotatedSuccess.title")}</DialogTitle>
            <DialogDescription>
              {t("RotatedSuccess.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {rotatedSecret ? (
              <ClientSecretField
                secret={rotatedSecret}
                label={t("RotatedSuccess.clientSecretLabel")}
                warning={t("RotatedSuccess.clientSecretWarning")}
                copyLabel={t("copy")}
                showLabel={t("RotatedSuccess.showSecret")}
                hideLabel={t("RotatedSuccess.hideSecret")}
                onCopy={handleCopy}
              />
            ) : null}
            <DialogFooter>
              <Button onClick={handleCredentialsDone}>
                {t("RotatedSuccess.doneButton")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
