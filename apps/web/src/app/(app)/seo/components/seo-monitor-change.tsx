"use client";

import type { ProjectSeoMonitorChange } from "@sokosumi/core-client";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  seoMonitorChangeOf,
  seoMonitorChangeSummary,
} from "./seo-monitor-model";

const pathOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
};

/** What the newest monitor result changed against the one before, with the named items one press away. */
export function SeoMonitorChange({
  change: stored,
}: {
  change: ProjectSeoMonitorChange | null;
}) {
  const change = seoMonitorChangeOf(stored);
  const t = useSeoResultTranslations("App.Seo.monitor.change");
  const devices = useSeoResultTranslations("App.Seo.breakdown.devices");
  const format = useSeoResultFormatter();
  const summary = seoMonitorChangeSummary(change);
  if (summary.kind === "none")
    return (
      <p lang="en" className="text-muted-foreground text-xs">
        {t("none")}
      </p>
    );
  if (summary.kind === "notComparable")
    return (
      <p lang="en" className="text-muted-foreground text-xs">
        {t("notComparable")}
      </p>
    );
  if (summary.kind === "same" || !change)
    return (
      <p lang="en" className="text-muted-foreground text-xs">
        {t("same")}
      </p>
    );
  const parts = [
    summary.newFailures
      ? t("newFailures", { count: summary.newFailures })
      : null,
    summary.fixed ? t("fixed", { count: summary.fixed }) : null,
    summary.drops ? t("drops", { count: summary.drops }) : null,
    summary.rises ? t("rises", { count: summary.rises }) : null,
    summary.lostCitations
      ? t("lostCitations", { count: summary.lostCitations })
      : null,
  ].filter((part): part is string => part !== null);
  const worse =
    summary.newFailures > 0 || summary.drops > 0 || summary.lostCitations > 0;
  return (
    <Collapsible lang="en" className="text-xs">
      <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-left">
        <span
          className={cn(worse ? "text-status-destructive" : "text-foreground")}
        >
          {t("summary", { parts: format.list(parts) })}
        </span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-1">
        {change.newFailures.length ? (
          <ChangeList title={t("newFailuresTitle")}>
            {change.newFailures.map((item) => (
              <li key={`${item.pageUrl}|${item.rowId}|${item.device}`}>
                {item.title}{" "}
                <span className="text-muted-foreground">
                  {pathOf(item.pageUrl)}
                </span>
              </li>
            ))}
          </ChangeList>
        ) : null}
        {change.fixed.length ? (
          <ChangeList title={t("fixedTitle")}>
            {change.fixed.map((item) => (
              <li key={`${item.pageUrl}|${item.rowId}|${item.device}`}>
                {item.title}{" "}
                <span className="text-muted-foreground">
                  {pathOf(item.pageUrl)}
                </span>
              </li>
            ))}
          </ChangeList>
        ) : null}
        {change.moves.length ? (
          <ChangeList title={t("movesTitle")}>
            {change.moves.map((move) => (
              <li
                key={`${move.pageUrl}|${move.keyword}|${move.device ?? ""}`}
                className={cn(
                  (move.to === null || move.to > move.from) &&
                    "text-status-destructive",
                )}
              >
                {move.to === null
                  ? t("lost", {
                      keyword: move.keyword,
                      from: move.from,
                      checked: move.checkedResults,
                    })
                  : t("move", {
                      keyword: move.keyword,
                      from: move.from,
                      to: move.to,
                    })}
              </li>
            ))}
          </ChangeList>
        ) : null}
        {change.lostCitations.length ? (
          <ChangeList title={t("lostCitationsTitle")}>
            {change.lostCitations.map((item) => (
              <li
                key={`${item.keyword}|${item.device}`}
                className="text-status-destructive"
              >
                {t(item.shown ? "lostCitation" : "lostCitationGone", {
                  keyword: item.keyword,
                })}{" "}
                <span className="text-muted-foreground">
                  {devices(item.device)}
                </span>
              </li>
            ))}
            {change.lostCitations.length < change.lostCitationCount ? (
              <li className="text-muted-foreground">
                {t("lostCitationsShowing", {
                  shown: change.lostCitations.length,
                  total: change.lostCitationCount,
                })}
              </li>
            ) : null}
          </ChangeList>
        ) : null}
        <p className="text-muted-foreground">{t("band")}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChangeList({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <p className="font-medium">{title}</p>
      <ul className="space-y-0.5 break-words">{children}</ul>
    </div>
  );
}
