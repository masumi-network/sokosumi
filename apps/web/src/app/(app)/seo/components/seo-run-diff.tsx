"use client";

import type { ProjectSeoRunDiff } from "@sokosumi/core-client";
import type { ReactNode } from "react";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import { pathOf } from "./seo-monitor-change";
import { seoRunDiffView } from "./seo-run-diff-model";
import { SeoEmpty, SeoSeverity } from "./seo-shared";

/**
 * What a check changed against the earlier comparable check: the issues that are new, fixed and still open.
 * The lists use fourth-level headings. `titled` adds the third-level heading where no caller names the section.
 */
export function SeoRunDiff({
  diff,
  titled,
}: {
  diff: ProjectSeoRunDiff;
  titled?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo");
  const view = seoRunDiffView(diff);
  const title = useSeoRunDiffTitle(diff);
  return (
    <section
      lang="en"
      aria-label={titled ? undefined : title}
      className="space-y-3 text-sm"
      data-testid="seo-run-diff"
    >
      {titled ? <h3 className="font-medium">{title}</h3> : null}
      {view.kind === "notComparable" ? (
        <SeoEmpty
          title={t("runDiff.notComparable.title")}
          body={
            view.reason ? t(`runDiff.notComparable.${view.reason}`) : undefined
          }
        />
      ) : (
        <>
          {view.rulebookChange ? (
            <p className="text-muted-foreground">
              {t("runDiff.rulebookChange", view.rulebookChange)}
            </p>
          ) : null}
          {view.issues ? (
            <p className="text-muted-foreground">
              {view.issues.from === null
                ? t("runDiff.issuesNow", { to: view.issues.to })
                : t("runDiff.issues", {
                    from: view.issues.from,
                    to: view.issues.to,
                  })}
            </p>
          ) : null}
          {view.lists.map((list) => (
            <DiffList
              key={list.id}
              title={t(`runDiff.${list.id}`, { count: list.total })}
              more={list.more}
              empty={list.total === 0}
            >
              {list.items.map((item) => (
                <SeoRunDiffIssue
                  key={JSON.stringify([item.pageUrl, item.rowId])}
                  issue={item}
                />
              ))}
            </DiffList>
          ))}
          {view.notCheckedAgain ? (
            <p className="text-muted-foreground">
              {t("runDiff.notCheckedAgain", { count: view.notCheckedAgain })}
            </p>
          ) : null}
          {view.notCheckedBefore ? (
            <p className="text-muted-foreground">
              {t("runDiff.notCheckedBefore", { count: view.notCheckedBefore })}
            </p>
          ) : null}
          {!view.lists.length && !view.moveCount ? (
            <p className="text-muted-foreground">{t("runDiff.noMoves")}</p>
          ) : null}
          {view.moveCount ? (
            <DiffList
              title={t("runDiff.moves", { count: view.moveCount })}
              more={view.moreMoves}
            >
              {view.moves.map((move) => (
                <li
                  key={JSON.stringify([
                    move.pageUrl,
                    move.keyword,
                    move.device,
                  ])}
                  className={cn(
                    "break-words",
                    move.to > move.from && "text-status-destructive",
                  )}
                >
                  {t("monitor.change.move", {
                    keyword: move.keyword,
                    from: move.from,
                    to: move.to,
                  })}{" "}
                  <span className="text-muted-foreground break-all">
                    {pathOf(move.pageUrl)}
                    {move.device
                      ? ` (${t("timeline.device", { device: move.device })})`
                      : null}
                  </span>
                </li>
              ))}
            </DiffList>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The heading of a comparison: the UTC day of the earlier check, as the runs row names its days. */
export function useSeoRunDiffTitle(diff: ProjectSeoRunDiff) {
  const t = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  return t("runDiff.title", {
    // The workspace reaches the page as JSON, so the date is a string.
    day: format.dateTime(new Date(diff.from), {
      dateStyle: "medium",
      timeZone: "UTC",
    }),
  });
}

/** One issue of a comparison: its rule, its page and device, and its severity. */
export function SeoRunDiffIssue({
  issue,
}: {
  issue: ProjectSeoRunDiff["new"][number];
}) {
  const t = useSeoResultTranslations("App.Seo");
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className="min-w-0 break-words">{issue.title}</span>
      <span className="text-muted-foreground min-w-0 break-all">
        {pathOf(issue.pageUrl)}
        {issue.device
          ? ` (${t("timeline.device", { device: issue.device })})`
          : null}
      </span>
      <SeoSeverity severity={issue.severity} />
    </li>
  );
}

function DiffList({
  title,
  more,
  empty,
  children,
}: {
  title: string;
  more: number;
  empty?: boolean;
  children: ReactNode;
}) {
  const t = useSeoResultTranslations("App.Seo");
  return (
    <div className="space-y-1">
      <h4 className="font-medium">{title}</h4>
      {empty ? (
        <p className="text-muted-foreground">{t("runDiff.none")}</p>
      ) : (
        // Safari drops the list role of a list without markers.
        <ul role="list" className="space-y-1">
          {children}
        </ul>
      )}
      {more ? (
        <p className="text-muted-foreground">
          {t("runDiff.more", { count: more })}
        </p>
      ) : null}
    </div>
  );
}
