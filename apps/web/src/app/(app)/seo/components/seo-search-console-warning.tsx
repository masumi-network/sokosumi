"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SearchConsoleWarning } from "@/lib/seo/search-console-warning";
import { SeoStatisticsDialog } from "./seo-statistics-dialog";
import { useSeoStatisticsProperties } from "./use-seo-statistics-properties";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoSearchConsoleWarning({
  reason,
  mode,
  model,
  price,
  selectingProperty = false,
  disabled = false,
  onClose,
  onRetry,
  onLimited,
}: {
  reason: SearchConsoleWarning;
  mode: "audit" | "monitor" | "manualRun";
  model: SeoWorkspaceModel;
  price?: string | null;
  selectingProperty?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onRetry: (propertyId?: string) => void;
  onLimited: () => void;
}) {
  const t = useTranslations("App.Seo");
  const [repairing, setRepairing] = useState(false);
  // A manual Run repairs its frozen pages for this Run alone.
  const [selectionContext] = useState(() =>
    mode === "manualRun" ? crypto.randomUUID() : undefined,
  );
  const selection = useSeoStatisticsProperties(
    model.data,
    "search_console",
    false,
    selectionContext,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("analysis.coverage.title")}</DialogTitle>
          <DialogDescription>
            {t(`analysis.coverage.${mode}`)} {price}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm" role="alert">
          {t(`analysis.coverage.${reason}`)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={model.pending}
            variant="outline"
            onClick={() => {
              setRepairing(true);
              void model.statisticsSync.refreshSearchConsoleAccess();
            }}
          >
            {t("statistics.title")}
          </Button>
          <Button
            type="button"
            loading={model.pending || selectingProperty}
            disabled={model.pending || selectingProperty || disabled}
            onClick={() => onRetry(selection.selectedPropertyId)}
          >
            {t(
              mode === "monitor"
                ? "analysis.coverage.retryMonitor"
                : "analysis.coverage.retry",
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={model.pending}
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={model.pending || disabled}
            onClick={onLimited}
          >
            {t(
              mode === "monitor"
                ? "analysis.coverage.limitedMonitor"
                : "analysis.coverage.limited",
            )}
          </Button>
        </DialogFooter>
        {repairing ? (
          <SeoStatisticsDialog
            model={model}
            source="search_console"
            chooseSearchProperty={mode === "manualRun" || reason === "property"}
            selectionContext={selectionContext}
            onClose={() => setRepairing(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
