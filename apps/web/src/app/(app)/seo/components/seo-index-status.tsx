"use client";

import type { ProjectSeoIndexedPage } from "@sokosumi/core-client";
import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoDate, SeoPageLink, SeoSection } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

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

/** Google's index verdict per page from the newest Search Console sync that inspected them. */
export function SeoIndexStatus({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const status = model.data.indexStatus;
  const inView = new Set(
    model.data.pages
      .filter((page) => model.data.scope.pageIds.includes(page.id))
      .map((page) => page.url),
  );
  const pages = status?.pages.filter((page) => inView.has(page.pageUrl)) ?? [];
  if (!pages.length) return null;
  // Pages in view that no sync could inspect are counted, never dropped silently.
  const unanswered = inView.size - pages.length;
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
              {inView.size > 1 ? <SeoPageLink url={page.pageUrl} /> : null}
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
            </li>
          );
        })}
      </ul>
    </SeoSection>
  );
}
