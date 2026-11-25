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
  const format = useSeoResultFormatter();
  const view = seoRunDiffView(diff);
  const title = t("runDiff.title", {
    day: format.dateTime(diff.from, { dateStyle: "medium" }),
  });
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
          {view.issues ? (
            <p className="text-muted-foreground">
              {t("runDiff.issues", view.issues)}
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
                <li
                  key={`${item.pageUrl}|${item.rowId}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="min-w-0 break-words">{item.title}</span>
                  <span className="text-muted-foreground min-w-0 break-all">
                    {pathOf(item.pageUrl)}
                    {item.device
                      ? ` (${t("timeline.device", { device: item.device })})`
                      : null}
                  </span>
                  <SeoSeverity severity={item.severity} />
                </li>
              ))}
            </DiffList>
          ))}
          {view.notCheckedAgain ? (
            <p className="text-muted-foreground">
              {t("runDiff.notCheckedAgain", { count: view.notCheckedAgain })}
            </p>
          ) : null}
          {view.moveCount ? (
            <DiffList
              title={t("runDiff.moves", { count: view.moveCount })}
              more={view.moreMoves}
            >
              {view.moves.map((move) => (
                <li
                  key={`${move.pageUrl}|${move.keyword}|${move.device ?? ""}`}
                  className={cn(
                    "break-words",
                    move.to > move.from && "text-status-destructive",
                  )}
                >
                  {t("monitor.change.move", {
                    keyword: move.keyword,
                    from: move.from,
                    to: move.to,
                  })}
                </li>
              ))}
            </DiffList>
          ) : null}
        </>
      )}
    </section>
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
        <ul className="space-y-1">{children}</ul>
      )}
      {more ? (
        <p className="text-muted-foreground">
          {t("runDiff.more", { count: more })}
        </p>
      ) : null}
    </div>
  );
}
