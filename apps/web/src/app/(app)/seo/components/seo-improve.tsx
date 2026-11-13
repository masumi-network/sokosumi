"use client";

import { SEO_CAPABILITIES_AS_OF } from "@sokosumi/utils";
import { Bot, Copy, Play, Plug, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  SEO_CAPABILITY_FILTERS,
  type SeoAuditGapFix,
  type SeoCapabilityFilter,
  seoAuditGaps,
  seoAuditGapValues,
  seoCapabilityGroups,
  seoUnlockSteps,
  seoViewNarrowed,
} from "./seo-improve-model";
import {
  SEO_ROW_LIST_CLASS,
  SeoEmpty,
  SeoSection,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const FIX_ICONS = {
  connect_search_console: Plug,
  connect_ga4: Plug,
  sync: RefreshCw,
  run_check: Play,
} as const;

/**
 * The Improve tab: what the agent cannot do yet, what this audit could not see, and how to get either
 * improved. The lists come from the catalog and the workspace; this view only renders them and forwards
 * the reader's choice.
 */
export function SeoImprove({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.improve");
  const format = useFormatter();
  const [filter, setFilter] = useState<SeoCapabilityFilter>("all");
  const groups = seoCapabilityGroups(filter);
  const narrowed = seoViewNarrowed(model.filters);
  const gaps = seoAuditGaps(model.data, narrowed);
  const steps = seoUnlockSteps(model.data, narrowed);
  // The chat belongs to an Audit; a Project's own workspace has none.
  const canAsk = Boolean(model.data.auditId);
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
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
    <div className="space-y-6">
      <SeoSection
        title={t("catalog.title")}
        description={t("catalog.help", { day: day(SEO_CAPABILITIES_AS_OF) })}
        actions={
          <div
            role="group"
            aria-label={t("catalog.filterLabel")}
            className="flex flex-wrap gap-1"
          >
            {SEO_CAPABILITY_FILTERS.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {t(`catalog.filter.${value}`)}
              </Button>
            ))}
          </div>
        }
      >
        <div className="space-y-4">
          {groups.map(({ group, items }) => (
            <section key={group} className="space-y-2">
              <h3 className="px-2 text-sm font-medium">
                {t(`groups.${group}`)}
              </h3>
              <ul className={SEO_ROW_LIST_CLASS}>
                {items.map((item) => {
                  const title = t(`items.${item.id}.title`);
                  const missing = t(`items.${item.id}.missing`);
                  return (
                    <li key={item.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 flex-1 font-medium">{title}</p>
                        <SeoState>{t(`status.${item.status}`)}</SeoState>
                      </div>
                      <p className="text-muted-foreground text-sm">{missing}</p>
                      <p className="text-muted-foreground text-xs">
                        {t("needs", {
                          list: format.list(
                            item.unlocks.map((unlock) =>
                              t(`unlocks.${unlock}`),
                            ),
                          ),
                        })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {canAsk ? (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t("askLabel", { title })}
                            onClick={() =>
                              model.openChat(t("askPrompt", { title, missing }))
                            }
                          >
                            <Bot className="size-4" />
                            {t("ask")}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("requestLabel", { title })}
                          onClick={() => {
                            void copy(
                              t("requestText", {
                                id: item.id,
                                title,
                                missing,
                              }),
                            );
                          }}
                        >
                          <Copy className="size-4" />
                          {t("request")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SeoSection>
      <SeoSection title={t("gaps.title")} description={t("gaps.help")}>
        {gaps.length ? (
          <ul className={SEO_ROW_LIST_CLASS}>
            {gaps.map((gap) => (
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
            ))}
          </ul>
        ) : (
          <SeoEmpty title={t("gaps.none")} />
        )}
      </SeoSection>
      <SeoSection title={t("steps.title")} description={t("steps.help")}>
        <ul className={SEO_ROW_LIST_CLASS}>
          {steps.map((step) => (
            <li
              key={step.unlock}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`unlocks.${step.unlock}`)}</p>
                <p className="text-muted-foreground text-xs">
                  {t("steps.items", { count: step.items })}
                </p>
              </div>
              {step.done ? (
                <SeoState>{t("steps.done")}</SeoState>
              ) : step.connect ? (
                <FixButton
                  fix={step.connect}
                  label={t(`fix.${step.connect}`)}
                  onClick={() => takeFix(step.connect as SeoAuditGapFix)}
                />
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground px-2 pt-1 text-sm">
          {t("steps.requests")}
        </p>
      </SeoSection>
    </div>
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
