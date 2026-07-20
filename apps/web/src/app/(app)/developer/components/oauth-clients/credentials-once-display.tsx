"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useClipboard } from "@/hooks/use-clipboard";

import type { CredentialsOnceDisplayProps } from "./types";

export function CredentialsOnceDisplay({
  credentials,
  onClose,
}: CredentialsOnceDisplayProps) {
  const t = useTranslations("App.Developer.OAuthClients");
  const { copied: clientIdCopied, copy: copyClientId } = useClipboard({
    copySuccessMessage: t("Messages.copySuccess"),
    copyErrorMessage: t("Messages.copyError"),
  });
  const { copied: clientSecretCopied, copy: copyClientSecret } = useClipboard({
    copySuccessMessage: t("Messages.copySuccess"),
    copyErrorMessage: t("Messages.copyError"),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("CreateDialog.CreatedSuccess.title")}</DialogTitle>
        <DialogDescription>
          {t("CreateDialog.CreatedSuccess.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">
            {t("CreateDialog.CreatedSuccess.clientIdLabel")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Input
              value={credentials.clientId}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyClientId(credentials.clientId)}
            >
              {clientIdCopied ? (
                <Check className="text-semantic-success size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              <span className="sr-only">{t("copy")}</span>
            </Button>
          </div>
        </div>

        {credentials.clientSecret ? (
          <div>
            <p className="text-sm font-medium">
              {t("CreateDialog.CreatedSuccess.clientSecretLabel")}
            </p>
            <p className="text-muted-foreground mb-2 text-xs">
              {t("CreateDialog.CreatedSuccess.clientSecretWarning")}
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={credentials.clientSecret}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyClientSecret(credentials.clientSecret!)}
              >
                {clientSecretCopied ? (
                  <Check className="text-semantic-success size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                <span className="sr-only">{t("copy")}</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button onClick={onClose}>
          {t("CreateDialog.CreatedSuccess.doneButton")}
        </Button>
      </DialogFooter>
    </>
  );
}
