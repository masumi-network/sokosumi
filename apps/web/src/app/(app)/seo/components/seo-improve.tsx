"use client";

import { Copy, Play, Plug, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type SeoAuditGapFix,
  seoAuditGaps,
  seoAuditGapValues,
  seoCapabilityGroups,
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
  sync: RefreshCw,
  run_check: Play,
} as const;

/**
 * What the agent cannot do yet, and what this audit could not see, from the header menu. A site owner can act on
 * little of it, so it is no tab: one line per item in plain words, and one quiet action on each row. The lists
 * come from the catalog and the workspace; this view only renders them and forwards the reader's choice.
 */
export function SeoImproveDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.improve");
  const tSeo = useTranslations("App.Seo");
  const format = useFormatter();
  const groups = seoCapabilityGroups();
  const gaps = seoAuditGaps(model.data, seoViewNarrowed(model.filters));
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
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
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
        <div className="space-y-4">
          {/* The one part the owner can change now leads; with no gap it takes no room. */}
          {gaps.length ? (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("gaps.title")}</h3>
              <ul className={SEO_ROW_LIST_CLASS}>
                {gaps.map((gap) => (
                  <li
                    key={`${gap.message}:${gap.note ?? ""}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  >
                    {/* The text keeps a readable width: on a phone the fix wraps below it. */}
                    <p className="min-w-48 flex-1">
                      {t(
                        `gaps.${gap.message}`,
                        seoAuditGapValues(gap, (names) => format.list(names)),
                      )}
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
          {groups.map(({ group, items }) => (
            <section key={group} className="space-y-2">
              <h3 className="text-sm font-medium">{t(`groups.${group}`)}</h3>
              <ul className={SEO_ROW_LIST_CLASS}>
                {items.map((item) => {
                  const title = t(`items.${item.id}.title`);
                  const missing = t(`items.${item.id}.missing`);
                  return (
                    <li
                      key={item.id}
                      className="flex items-start gap-2 py-3 ps-4 pe-2"
                    >
                      {/* The plain line leads; the SEO term under it is small and muted. */}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm">{missing}</p>
                        <p className="text-muted-foreground text-xs">{title}</p>
                      </div>
                      {/* An icon: thirty worded buttons read as thirty equal choices. Its name says what it copies. */}
                      <Button
                        size="icon"
                        variant="ghost"
                        // The negative margin centres the icon on the first line of text.
                        className="text-muted-foreground hover:text-foreground -my-2.5 shrink-0 md:-my-1.5 md:size-8"
                        aria-label={t("requestLabel", { title })}
                        title={t("request")}
                        onClick={() => {
                          void copy(
                            t("requestText", { id: item.id, title, missing }),
                          );
                        }}
                      >
                        <Copy className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
