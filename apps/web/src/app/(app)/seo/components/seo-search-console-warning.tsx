"use client";

import { KeyRound, ScanSearch } from "lucide-react";
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
  const [reviewedConnection, setReviewedConnection] = useState(false);
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
            {t(`analysis.coverage.${mode}`)}
            {price ? (
              <span className="text-foreground mt-2 block font-medium">
                {price}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound aria-hidden className="size-4" />
              {t("analysis.coverage.withSearch")}
            </h3>
            <p className="text-muted-foreground text-sm" role="alert">
              {t(`analysis.coverage.${reason}`)}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("analysis.coverage.privateConnection")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={model.pending || selectingProperty}
                variant={
                  reason === "unavailable" || reviewedConnection
                    ? "outline"
                    : "primary"
                }
                onClick={() => {
                  setRepairing(true);
                  void model.statisticsSync.refreshSearchConsoleAccess();
                }}
              >
                {t("statistics.title")}
              </Button>
              {reason === "unavailable" || reviewedConnection ? (
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
              ) : null}
            </div>
          </section>
          <section className="space-y-2 border-t pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ScanSearch aria-hidden className="size-4" />
              {t("analysis.coverage.withoutSearch")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("analysis.coverage.limitedScope")}
            </p>
          </section>
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
            disabled={model.pending || selectingProperty || disabled}
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
            onClose={() => {
              setRepairing(false);
              setReviewedConnection(true);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
