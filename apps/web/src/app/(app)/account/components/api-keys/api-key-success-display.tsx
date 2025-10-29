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
import { useClipboard } from "@/hooks/use-clipboard";

import { ApiKeySuccessDisplayProps } from "./types";

/**
 * Component that displays a created API key with copy functionality
 * Shows the API key in a copiable format with visual feedback
 */
export function ApiKeySuccessDisplay({
  apiKey,
  onClose,
}: ApiKeySuccessDisplayProps) {
  const t = useTranslations("App.Account.ApiKeys");
  const { copied, copy } = useClipboard();

  const handleCopy = async () => {
    await copy(apiKey);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("CreateDialog.CreatedSuccess.title")}</DialogTitle>
        <DialogDescription>
          {t("CreateDialog.CreatedSuccess.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-md py-4">
          <button
            onClick={handleCopy}
            className="bg-muted hover:bg-muted/80 group relative block w-full cursor-pointer rounded px-[1rem] py-[1rem] text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <code className="pr-2 font-mono text-sm break-all">{apiKey}</code>
              {copied ? (
                <Check className="text-semantic-success h-4 w-4 flex-shrink-0" />
              ) : (
                <Copy className="text-muted-foreground group-hover:text-foreground h-4 w-4 flex-shrink-0 transition-colors" />
              )}
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>
            {t("CreateDialog.CreatedSuccess.doneButton")}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
