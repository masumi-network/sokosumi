"use client";

import { Play, Plug, RefreshCw } from "lucide-react";
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
import { SEO_ROW_LIST_CLASS } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

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
  const format = useFormatter();
  const groups = seoCapabilityGroups();
  const gaps = seoAuditGaps(model.data, seoViewNarrowed(model.filters));
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
          <DialogDescription>{t("catalog.help")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium">{title}</p>
                        <p className="text-muted-foreground text-sm">
                          {missing}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        aria-label={t("requestLabel", { title })}
                        onClick={() => {
                          void copy(
                            t("requestText", { id: item.id, title, missing }),
                          );
                        }}
                      >
                        {t("request")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("gaps.title")}</h3>
            <ul className={SEO_ROW_LIST_CLASS}>
              {gaps.length ? (
                gaps.map((gap) => (
                  <li
                    key={`${gap.message}:${gap.note ?? ""}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                  >
                    <p className="min-w-0 flex-1">
                      {t(
                        `gaps.${gap.message}`,
                        seoAuditGapValues(gap, (names) => format.list(names)),
                      )}
                    </p>
                    {gap.fix ? (
                      <FixButton
                        fix={gap.fix}
                        label={t(`fix.${gap.fix}`)}
                        onClick={() => takeFix(gap.fix as SeoAuditGapFix)}
                      />
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground px-4 py-3 text-sm">
                  {t("gaps.none")}
                </li>
              )}
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
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <Icon className="size-4" />
      {label}
    </Button>
  );
}
