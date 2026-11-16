"use client";

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
import type { SeoStatisticsProvider } from "./seo-statistics-model";
import { SeoStatisticsSource } from "./seo-statistics-source";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Search Console first: it is the first Google approval and the one most views need. */
const SOURCES: SeoStatisticsProvider[] = ["search_console", "ga4"];

/**
 * The two Google sources, each in its own section with its account and its
 * property. No source is chosen first: both are in view, and the one the
 * reader came for is marked.
 */
export function SeoStatisticsDialog({
  model,
  source,
}: {
  model: SeoWorkspaceModel;
  source?: SeoStatisticsProvider;
}) {
  const t = useTranslations("App.Seo");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent
        // No button takes the first focus: one Enter must not start a Google approval. A dialog
        // opened for one source focuses its section, so the next Tab reaches that source's control;
        // else the dialog itself. A control may still be loading here, so none is chosen.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget as HTMLElement | null;
          (
            content?.querySelector<HTMLElement>("[data-focused]") ?? content
          )?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("statistics.title")}</DialogTitle>
          <DialogDescription>{t("statistics.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {SOURCES.map((provider) => (
            <SeoStatisticsSource
              key={provider}
              model={model}
              provider={provider}
              focused={provider === source}
            />
          ))}
        </div>
        <div className="text-muted-foreground space-y-1 text-sm">
          <p>{t("statistics.ownerOnly")}</p>
          {model.data.sharing === "organization" ? (
            <p>{t("statistics.shared")}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={model.pending}
            onClick={() => model.setDialog(null)}
          >
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
