"use client";

import { RefreshCw, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";

import { DESIGN_MD_TRANSLATION_NAMESPACE, type DesignMdOwner } from "./types";
import { useDesignMdGeneration } from "./use-design-md-generation";

// Stable reference: `useDesignMdGeneration`'s callbacks depend on `owner`, and
// this is the same value on every render regardless.
const AD_HOC_OWNER: DesignMdOwner = { type: "adhoc" };

export interface DesignMdAdHocAttachment {
  label: string;
  url: string;
  /** The company website the caller entered, for display (e.g. "acme.com
   * Brand Design") — distinct from `url`, the generated blob's location. */
  sourceUrl: string;
}

interface DesignMdAdHocDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (attachment: DesignMdAdHocAttachment) => void;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Generates a DESIGN.md for one-off, ad hoc use — a task that wants a
 * different company's branding than the caller's own. Nothing here is
 * attached to the caller's user or organization profile; the generated
 * attachment lives only in the caller's hands until they attach it to a task.
 */
export function DesignMdAdHocDialog({
  open,
  onOpenChange,
  onGenerated,
}: DesignMdAdHocDialogProps) {
  const t = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [url, setUrl] = useState("");

  const handleCompleted = useCallback(
    (designMd: PersistedDesignMd) => {
      toast.success(t("generateSuccess"));
      onGenerated({
        label: "DESIGN.md",
        url: designMd.url,
        sourceUrl: normalizeUrl(url),
      });
      onOpenChange(false);
    },
    [onGenerated, onOpenChange, t, url],
  );

  const generation = useDesignMdGeneration({
    messages: {
      generationFailed: t("generateError"),
      saveFailed: t("saveError"),
      startFailed: t("startGenerateError"),
    },
    onCompleted: handleCompleted,
    owner: AD_HOC_OWNER,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && generation.isRunning) return;
      onOpenChange(nextOpen);
      if (!nextOpen) {
        generation.reset();
        setUrl("");
      }
    },
    [generation, onOpenChange],
  );

  const handleGenerate = useCallback(() => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      toast.error(t("adHocMissingUrl"));
      return;
    }

    void generation.generate({ url: normalized });
  }, [generation, t, url]);

  const statusText =
    generation.status === "finalizing"
      ? t("finalizing")
      : generation.status === "polling"
        ? t("polling")
        : t("starting");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("adHocDialogTitle")}</DialogTitle>
          <DialogDescription>{t("adHocDialogDescription")}</DialogDescription>
        </DialogHeader>

        {generation.errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>{t("generateErrorTitle")}</AlertTitle>
            <AlertDescription>{generation.errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {generation.isRunning ? (
          <div className="space-y-3" aria-live="polite">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <RefreshCw className="size-4 animate-spin" />
              <span>{statusText}</span>
            </div>
            <Progress value={generation.status === "finalizing" ? 85 : 45} />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="design-md-adhoc-url">{t("adHocUrlLabel")}</Label>
            <Input
              id="design-md-adhoc-url"
              type="text"
              inputMode="url"
              placeholder={t("adHocUrlPlaceholder")}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleGenerate();
              }}
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={generation.isRunning}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!url.trim() || generation.isRunning}
          >
            {generation.isRunning ? (
              t("generating")
            ) : (
              <>
                <WandSparkles className="size-4" />
                {t("confirmGenerate")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
