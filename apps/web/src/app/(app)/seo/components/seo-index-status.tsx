"use client";

import type {
  ProjectSeoIndexedPage,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoIndexNote } from "./seo-index-triage";
import { seoIndexTriage } from "./seo-index-triage-model";
import { SeoDate, SeoPageLink, SeoSection } from "./seo-shared";

type Verdict = ProjectSeoIndexedPage["verdict"];
/** Google's verdicts, as one plain state each. NEUTRAL means Google left the page out. */
const STATE: Record<
  Verdict,
  "indexed" | "warnings" | "notIndexed" | "unknown"
> = {
  PASS: "indexed",
  PARTIAL: "warnings",
  FAIL: "notIndexed",
  NEUTRAL: "notIndexed",
  VERDICT_UNSPECIFIED: "unknown",
};
const ICON = {
  indexed: CircleCheck,
  warnings: CircleAlert,
  notIndexed: CircleAlert,
  unknown: CircleHelp,
};

/** The canonical Google chose, when it is not the one the page asks for. */
export function seoOtherCanonical(page: ProjectSeoIndexedPage) {
  const chosen = page.googleCanonical;
  if (!chosen) return null;
  return chosen === (page.userCanonical ?? page.pageUrl) ? null : chosen;
}

/**
 * Google's index verdict per page from the newest Search Console sync that inspected them, with the agent's review
 * note of the page under it. A note of a URL without a verdict, such as a related URL, is a row of its own.
 */
export function SeoIndexStatus({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const status = workspace.indexStatus;
  const inView = new Set(
    workspace.pages
      .filter((page) => workspace.scope.pageIds.includes(page.id))
      .map((page) => page.url),
  );
  const pages = status?.pages.filter((page) => inView.has(page.pageUrl)) ?? [];
  const notes = seoIndexTriage(workspace)?.assessments ?? [];
  const notesOf = (pageUrl: string) =>
    notes.filter((note) => note.pageUrl === pageUrl);
  const alone = notes.filter(
    (note) => !pages.some((page) => page.pageUrl === note.pageUrl),
  );
  if (!pages.length && !alone.length) return null;
  // Pages in view that no sync could inspect are counted, never dropped silently.
  // A page with a note row of its own has Google's words there: it is not counted as unanswered.
  const unanswered = [...inView].filter(
    (url) =>
      !pages.some((page) => page.pageUrl === url) &&
      !alone.some((note) => note.pageUrl === url),
  ).length;
  return (
    <SeoSection
      title={t("index.title")}
      description={
        <>
          {t("index.help")}
          {unanswered > 0
            ? ` ${t("index.unanswered", { count: unanswered })}`
            : null}
        </>
      }
    >
      <ul className={cn(HOLDER_ITEM_CLASS, "divide-y")}>
        {pages.map((page) => {
          const state = STATE[page.verdict];
          const Icon = ICON[state];
          const canonical = seoOtherCanonical(page);
          return (
            <li key={page.pageUrl} className="space-y-1 p-4">
              <p className="flex items-center gap-2 font-medium">
                <Icon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0",
                    state !== "indexed" && "text-muted-foreground",
                  )}
                />
                {t(`index.state.${state}`)}
              </p>
              {/* Beside a note row that names its URL, every row names its own. */}
              {inView.size > 1 || alone.length ? (
                <SeoPageLink url={page.pageUrl} />
              ) : null}
              {page.coverageState ? (
                <p className="text-muted-foreground text-sm">
                  {t("index.google", { words: page.coverageState })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-sm">
                {t("index.lastCrawl")} <SeoDate value={page.lastCrawlTime} /> ·{" "}
                {t("index.checked")} <SeoDate value={page.checkedAt} />
              </p>
              {canonical ? (
                <p className="text-sm">
                  {t("index.otherCanonical")} <SeoPageLink url={canonical} />
                </p>
              ) : null}
              {notesOf(page.pageUrl).map((note) => (
                <div
                  key={JSON.stringify([
                    note.auditPageUrl ?? note.pageUrl,
                    note.pageUrl,
                  ])}
                  className="border-border mt-3 border-t pt-3"
                >
                  <SeoIndexNote assessment={note} alone={false} />
                </div>
              ))}
            </li>
          );
        })}
        {alone.map((note) => (
          <li
            key={JSON.stringify([
              note.auditPageUrl ?? note.pageUrl,
              note.pageUrl,
            ])}
            className="p-4"
          >
            <SeoIndexNote assessment={note} alone />
          </li>
        ))}
      </ul>
    </SeoSection>
  );
}
