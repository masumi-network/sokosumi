"use client";

import type {
  ProjectSeoIndexedPage,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { seoIndexReviewState } from "@sokosumi/utils";
import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoIndexNote } from "./seo-index-triage";
import { seoIndexEvidence, seoIndexStatusView } from "./seo-index-triage-model";
import { SeoDate, SeoPageLink, SeoSection, SeoState } from "./seo-shared";

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
  fine: CircleCheck,
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
 * notes of the page under it. A note of a URL without a verdict, such as a related URL, is a row of its own.
 */
export function SeoIndexStatus({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  const t = useTranslations("App.Seo");
  const { inView, pages, notes, alone, unanswered } =
    seoIndexStatusView(workspace);
  const notesOf = (pageUrl: string) =>
    notes.filter((note) => note.pageUrl === pageUrl);
  if (!pages.length && !alone.length) return null;
  return (
    <SeoSection
      title={t("index.title")}
      description={
        unanswered > 0 ? t("index.unanswered", { count: unanswered }) : null
      }
    >
      <ul className={cn(HOLDER_ITEM_CLASS, "divide-y")}>
        {pages.map((page) => {
          const state = STATE[page.verdict];
          const canonical = seoOtherCanonical(page);
          const pageNotes = notesOf(page.pageUrl);
          // Google's verdict "Indexed" reads as fine, even beside the badge of a note that asks for a check. A page Google left out
          // reads as fine only when every review expects the exclusion for the reason Google gives now: a note about an
          // earlier reason says nothing about the current one.
          const fine =
            state === "indexed" ||
            (state === "notIndexed" &&
              page.coverageState != null &&
              pageNotes.length > 0 &&
              pageNotes.every(
                (note) =>
                  note.status === "expected_exclusion" &&
                  seoIndexEvidence(note.evidence).reason === page.coverageState,
              ));
          const icon = fine ? "fine" : state;
          const Icon = ICON[icon];
          // Notes of one state share a badge on the verdict line; notes of different states each carry their own.
          const noteStates = [
            ...new Set(pageNotes.map((note) => seoIndexReviewState(note))),
          ];
          const shared = noteStates.length === 1;
          return (
            <li key={page.pageUrl} className="space-y-1 p-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-2 font-medium">
                  <Icon
                    aria-hidden
                    data-icon={icon}
                    className={cn(
                      "size-4 shrink-0",
                      !fine && "text-muted-foreground",
                    )}
                  />
                  {t(`index.state.${state}`)}
                </span>
                {page.coverageState ? (
                  <>
                    {/* A mark for the eye, not a word to read out. */}
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                    <span className="text-muted-foreground">
                      {t("indexReview.googleReason", {
                        reason: page.coverageState,
                      })}
                    </span>
                  </>
                ) : null}
                {shared &&
                !(state === "unknown" && noteStates[0] === "unknown") ? (
                  <SeoState>
                    {noteStates[0] === "unknown"
                      ? t("index.state.unknown")
                      : t(`indexReview.state.${noteStates[0]}`)}
                  </SeoState>
                ) : null}
              </p>
              {/* Beside a note row that names its URL, every row names its own. */}
              {inView.size > 1 || alone.length ? (
                <SeoPageLink url={page.pageUrl} />
              ) : null}
              <p className="text-muted-foreground text-sm">
                {t("index.lastCrawl")}{" "}
                <SeoDate value={page.lastCrawlTime} day />
              </p>
              {canonical ? (
                <p className="text-sm">
                  {t("index.otherCanonical")} <SeoPageLink url={canonical} />
                </p>
              ) : null}
              {/* Notes of one page can come from different audited URLs: a line parts them. */}
              {pageNotes.map((note, index) => (
                <div
                  key={JSON.stringify([
                    note.auditPageUrl ?? note.pageUrl,
                    note.pageUrl,
                  ])}
                  className={cn(
                    index > 0 && "border-border mt-3 border-t pt-3",
                  )}
                >
                  <SeoIndexNote
                    assessment={note}
                    alone={false}
                    badge={!shared}
                    statusReadAt={page.checkedAt}
                  />
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
