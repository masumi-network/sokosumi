"use client";

import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HermesIntegrationProvider } from "@/lib/hermes/types";

interface ConnectInterstitialProps {
  /** When set, the modal is open and configured for this connect attempt. */
  pending: {
    /** Slug — drives the OAuth-provider label below. */
    provider: HermesIntegrationProvider;
    providerName: string;
    mode: "read" | "write";
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown right before we open the Composio OAuth popup. Sets the expectation
 * that the consent screen will look broad because Hermes uses Composio's
 * verified OAuth client — explicit so the user doesn't bail mid-consent
 * when they see "Send mail on your behalf" listed even though they clicked
 * "Connect (read only)".
 */
export default function ConnectInterstitial({
  pending,
  onConfirm,
  onCancel,
}: ConnectInterstitialProps) {
  const t = useTranslations("App.Hermes.ConnectInterstitial");
  const tCommon = useTranslations("App.Hermes.Common");
  const isOpen = pending !== null;
  const authProvider = pending ? t(`authProviders.${pending.provider}`) : null;
  const providerLabel = authProvider ?? t("providerFallback");

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 text-primary mb-3 flex size-10 items-center justify-center rounded-lg">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t("description", { provider: providerLabel })}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="border-border/60 bg-card/40 mt-2 rounded-lg border p-4 text-sm">
            <div className="text-foreground mb-1.5 font-medium">
              {t("pickedPrefix")}{" "}
              <span
                className={
                  pending.mode === "write"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {pending.mode === "write"
                  ? t("modeFullAccess")
                  : t("modeReadOnly")}
              </span>{" "}
              {t("pickedSuffix", { providerName: pending.providerName })}
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {pending.mode === "write"
                ? t("bodyWrite")
                : t("bodyReadOnly", { authProvider: providerLabel })}
            </p>
          </div>
        ) : null}

        <DialogFooter className="mt-2 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="gap-1.5"
            onClick={onConfirm}
          >
            <span>
              {t("continueTo", {
                provider: authProvider ?? t("continueFallback"),
              })}
            </span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
