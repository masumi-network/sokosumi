"use client";

import { RefreshCw, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { PersistedDesignMd } from "@/lib/services/design-md.service";

import { DESIGN_MD_TRANSLATION_NAMESPACE, type DesignMdOwner } from "./types";
import { useDesignMdGeneration } from "./use-design-md-generation";

interface DesignMdGenerateDialogProps {
  disabled?: boolean;
  hasExistingDesignMd?: boolean;
  hideTrigger?: boolean;
  onGenerated?: (designMd: PersistedDesignMd) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  owner: DesignMdOwner;
  websiteUrl?: null | string;
}

export function DesignMdGenerateDialog({
  disabled = false,
  hasExistingDesignMd = false,
  hideTrigger = false,
  onGenerated,
  onOpenChange,
  open,
  owner,
  websiteUrl,
}: DesignMdGenerateDialogProps) {
  const t = useTranslations(DESIGN_MD_TRANSLATION_NAMESPACE);
  const [internalOpen, setInternalOpen] = useState(false);
  const [force, setForce] = useState(false);
  const isOpen = open ?? internalOpen;
  const setDialogOpen = useCallback(
    (nextOpen: boolean) => {
      setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const handleCompleted = useCallback(
    (designMd: PersistedDesignMd) => {
      onGenerated?.(designMd);
      toast.success(t("generateSuccess"));
      setDialogOpen(false);
      setForce(false);
    },
    [onGenerated, setDialogOpen, t],
  );

  const generation = useDesignMdGeneration({
    messages: {
      generationFailed: t("generateError"),
      saveFailed: t("saveError"),
      startFailed: t("startGenerateError"),
    },
    onCompleted: handleCompleted,
    owner,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && generation.isRunning) return;
      setDialogOpen(nextOpen);
      if (!nextOpen) {
        generation.reset();
        setForce(false);
      }
    },
    [generation, setDialogOpen],
  );

  const handleGenerate = useCallback(() => {
    if (!websiteUrl) {
      toast.error(t("missingWebsite"));
      return;
    }

    void generation.generate({ force, url: websiteUrl });
  }, [force, generation, t, websiteUrl]);

  const statusText =
    generation.status === "finalizing"
      ? t("finalizing")
      : generation.status === "polling"
        ? t("polling")
        : t("starting");

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button type="button" disabled={disabled || !websiteUrl}>
            <WandSparkles className="size-4" />
            {hasExistingDesignMd ? t("regenerateButton") : t("generateButton")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("generateDialogTitle")}</DialogTitle>
          <DialogDescription>
            {websiteUrl
              ? t("generateDialogDescription", { websiteUrl })
              : t("missingWebsite")}
          </DialogDescription>
        </DialogHeader>

        {generation.errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>{t("generateErrorTitle")}</AlertTitle>
            <AlertDescription>{generation.errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {generation.isRunning ? (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <RefreshCw className="size-4 animate-spin" />
              <span>{statusText}</span>
            </div>
            <Progress value={generation.status === "finalizing" ? 85 : 45} />
          </div>
        ) : (
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              checked={force}
              onCheckedChange={(checked) => setForce(checked === true)}
              aria-label={t("forceRegenerateAria")}
            />
            <span className="space-y-1">
              <span className="block font-medium text-sm">
                {t("forceRegenerateLabel")}
              </span>
              <span className="block text-muted-foreground text-sm">
                {t("forceRegenerateDescription")}
              </span>
            </span>
          </label>
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
            disabled={!websiteUrl || generation.isRunning}
          >
            {generation.isRunning ? t("generating") : t("confirmGenerate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
