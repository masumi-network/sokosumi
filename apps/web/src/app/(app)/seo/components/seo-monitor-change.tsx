"use client";

import type { ProjectSeoMonitorChange } from "@sokosumi/core-client";
import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { seoMonitorChangeSummary } from "./seo-monitor-model";

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
  change,
}: {
  change: ProjectSeoMonitorChange | null;
}) {
  const t = useTranslations("App.Seo.monitor.change");
  const format = useFormatter();
  const summary = seoMonitorChangeSummary(change);
  if (summary.kind === "none")
    return <p className="text-muted-foreground text-xs">{t("none")}</p>;
  if (summary.kind === "notComparable")
    return (
      <p className="text-muted-foreground text-xs">{t("notComparable")}</p>
    );
  if (summary.kind === "same" || !change)
    return <p className="text-muted-foreground text-xs">{t("same")}</p>;
  const parts = [
    summary.newFailures
      ? t("newFailures", { count: summary.newFailures })
      : null,
    summary.fixed ? t("fixed", { count: summary.fixed }) : null,
    summary.drops ? t("drops", { count: summary.drops }) : null,
    summary.rises ? t("rises", { count: summary.rises }) : null,
  ].filter((part): part is string => part !== null);
  const worse = summary.newFailures > 0 || summary.drops > 0;
  return (
    <Collapsible className="text-xs">
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
                className={cn(move.to > move.from && "text-status-destructive")}
              >
                {t("move", {
                  keyword: move.keyword,
                  from: move.from,
                  to: move.to,
                })}
              </li>
            ))}
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
