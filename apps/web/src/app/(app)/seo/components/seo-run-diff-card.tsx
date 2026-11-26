"use client";

import type { ProjectSeoRunDiff } from "@sokosumi/core-client";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { cn } from "@/lib/utils";
import {
  SeoRunDiff,
  SeoRunDiffIssue,
  useSeoRunDiffTitle,
} from "./seo-run-diff";
import { SEO_RUN_DIFF_CARD_ISSUES, seoRunDiffView } from "./seo-run-diff-model";
import { SeoFoldSummary } from "./seo-shared";

/**
 * What the newest check changed, open on the Agent tab: how many issues are new, fixed and still open, the first new
 * issues, and every change in a fold. A comparison with no issue counts stays in its fold.
 */
export function SeoRunDiffCard({ diff }: { diff: ProjectSeoRunDiff }) {
  const t = useSeoResultTranslations("App.Seo");
  const title = useSeoRunDiffTitle(diff);
  const view = seoRunDiffView(diff);
  const fold = (label: string) => (
    <details data-testid="seo-agent-run-diff">
      <SeoFoldSummary className="text-muted-foreground text-sm">
        <span lang="en">{label}</span>
      </SeoFoldSummary>
      <div className="pt-2">
        <SeoRunDiff diff={diff} />
      </div>
    </details>
  );
  // Not comparable, or a check with no issue total, such as a ranking check: three counts would claim a scope it lacks.
  if (view.kind === "notComparable" || !view.issues)
    return fold(t("runDiff.open"));
  const added = view.lists.find((list) => list.id === "new");
  return (
    // No region of its own: the full comparison in its fold already is one, under the same name.
    <div
      lang="en"
      className="space-y-2 text-sm"
      data-testid="seo-agent-run-diff-card"
    >
      <h4 className="font-medium">{title}</h4>
      <dl className="grid grid-cols-3 gap-2">
        {view.lists.map((list) => (
          <div key={list.id} className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground text-xs">
              {t(`runDiff.count.${list.id}`)}
            </dt>
            <dd
              className={cn(
                "text-lg font-semibold tabular-nums",
                list.total > 0 &&
                  list.id === "new" &&
                  "text-status-destructive",
                list.total > 0 && list.id === "fixed" && "text-status-success",
              )}
            >
              {list.total}
            </dd>
          </div>
        ))}
      </dl>
      {/* The counts cover only the rules both checks ran: say so beside them, not only in the fold. */}
      {view.rulebookChange ? (
        <p className="text-muted-foreground">
          {t("runDiff.rulebookChange", view.rulebookChange)}
        </p>
      ) : null}
      {/* Issues with no clear result in one check are outside the counts: say so beside them. */}
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
      {added?.items.length ? (
        // Safari drops the list role of a list without markers.
        <ul
          role="list"
          aria-label={t("runDiff.firstNew")}
          className="space-y-1"
        >
          {added.items.slice(0, SEO_RUN_DIFF_CARD_ISSUES).map((item) => (
            <SeoRunDiffIssue
              key={JSON.stringify([item.pageUrl, item.rowId])}
              issue={item}
            />
          ))}
        </ul>
      ) : null}
      {fold(t("runDiff.all"))}
    </div>
  );
}
