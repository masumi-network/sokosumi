"use client";

import { Play, Plug, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import {
  type SeoAuditGapFix,
  seoCustomerAuditGaps,
  seoCustomerLimitations,
  seoViewNarrowed,
} from "./seo-improve-model";
import { seoRunAction } from "./seo-setup-model";
import { SEO_ROW_LIST_CLASS } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The source a connect fix opens: two fixes share the words "Set up statistics", so the name of each says its source. */
const FIX_SOURCES = {
  connect_search_console: "Search Console",
  connect_ga4: "Google Analytics",
} as const satisfies Partial<Record<SeoAuditGapFix, string>>;

const FIX_ICONS = {
  connect_search_console: Plug,
  connect_ga4: Plug,
  sync: Settings2,
  run_check: Play,
} as const;

/**
 * A short customer-facing summary of agent limits and missing audit data.
 * The model groups the details; the view forwards setup or check intent.
 */
export function SeoImproveDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.improve");
  const result = useSeoResultTranslations("App.Seo.improve");
  const tSeo = useTranslations("App.Seo");
  const limitations = seoCustomerLimitations();
  const gaps = seoCustomerAuditGaps(model.data, seoViewNarrowed(model.filters));
  // A run fix takes the header's words, so one run has one name.
  const run = seoRunAction(model.data);
  const fixLabel = (fix: SeoAuditGapFix) =>
    fix === "run_check" && run && !run.running
      ? tSeo(run.label)
      : t(`fix.${fix}`);
  function takeFix(fix: SeoAuditGapFix) {
    if (fix === "connect_search_console")
      model.openStatistics("search_console");
    else if (fix === "connect_ga4") model.openStatistics("ga4");
    else if (fix === "sync") model.openStatistics();
    else model.setDialog("analysis");
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) model.setDialog(null);
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("catalog.title")}</DialogTitle>
          {/* The title says it: the line stays for screen readers only. */}
          <DialogDescription className="sr-only">
            {t("catalog.help")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* The one part the owner can change now leads; with no gap it takes no room. */}
          {gaps.length ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("gaps.title")}</h3>
              <ul className={SEO_ROW_LIST_CLASS}>
                {gaps.map((gap) => (
                  <li
                    key={gap.message}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  >
                    {/* The text keeps a readable width: on a phone the fix wraps below it. */}
                    <p className="min-w-48 flex-1">
                      {result(`gaps.${gap.message}`, {
                        count: gap.count ?? 0,
                        limit: gap.count ?? 0,
                      })}
                    </p>
                    {gap.fix ? (
                      <FixButton
                        fix={gap.fix}
                        label={fixLabel(gap.fix)}
                        onClick={() => takeFix(gap.fix as SeoAuditGapFix)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("summary.title")}</h3>
            <ul className="text-muted-foreground list-disc space-y-3 ps-4 text-sm">
              {limitations.map((limitation) => (
                <li key={limitation}>{t(`summary.${limitation}`)}</li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FixButton({
  fix,
  label,
  onClick,
}: {
  fix: SeoAuditGapFix;
  label: string;
  onClick: () => void;
}) {
  const Icon = FIX_ICONS[fix];
  const source =
    fix in FIX_SOURCES ? FIX_SOURCES[fix as keyof typeof FIX_SOURCES] : null;
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={source ? `${label}: ${source}` : undefined}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </Button>
  );
}
