import type {
  ProjectSeoRunDiff,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { isSeoRuleCheck } from "./seo-runs-model";
import type { SeoStopNode } from "./seo-timeline-model";

type Issue = ProjectSeoRunDiff["new"][number];

/** New issues the Agent tab names under its counts. The fold under them lists the rest. */
export const SEO_RUN_DIFF_CARD_ISSUES = 3;

export interface SeoRunDiffList {
  id: "new" | "fixed" | "stillOpen";
  items: Issue[];
  /** All issues of this kind. Core sends only the first rows of a long list. */
  total: number;
  /** The issues the list does not name. */
  more: number;
}

export type SeoRunDiffView =
  | {
      kind: "notComparable";
      reason: NonNullable<ProjectSeoRunDiff["reason"]> | null;
    }
  | {
      kind: "compared";
      lists: SeoRunDiffList[];
      notCheckedAgain: number;
      notCheckedBefore: number;
      /** Null where one of the two checks has no issue count. */
      issues: { from: number; to: number } | null;
      moves: ProjectSeoRunDiff["numbers"]["moves"];
      moveCount: number;
      moreMoves: number;
      /** Set where the rulebook changed: only the rules both checks tested are compared. */
      rulebookChange: NonNullable<ProjectSeoRunDiff["rulebookChange"]> | null;
    };

/** What the check with this id changed against the earlier comparable check. The first check of a kind has none. */
export function seoRunDiffOf(
  workspace: Pick<ProjectSeoWorkspace, "runs">,
  observationId: string | undefined,
): ProjectSeoRunDiff | null {
  if (!observationId) return null;
  return (
    workspace.runs?.find((run) => run.observationId === observationId)
      ?.runDiff ?? null
  );
}

/**
 * Open issues the check counts that its comparison leaves out: Search Console indexing issues add to the issue count
 * of a check, not to its page issues. Zero where either count is missing.
 */
export function seoRunIssuesOutsideDiff(
  workspace: Pick<ProjectSeoWorkspace, "runs">,
  observationId: string | undefined,
): number {
  const run = workspace.runs?.find(
    (row) => row.observationId === observationId,
  );
  const now = run?.runDiff?.numbers.issues.to;
  return run?.issues == null || now == null ? 0 : Math.max(0, run.issues - now);
}

/** The newest page check of a stop's events, as the day counts: a ranking check there may be an older one. */
export function seoStopCheckId(nodes: SeoStopNode[]): string | undefined {
  return nodes.find(
    ({ observation }) => observation && isSeoRuleCheck(observation.kind),
  )?.observation?.id;
}

export function seoRunDiffView(diff: ProjectSeoRunDiff): SeoRunDiffView {
  if (!diff.comparable)
    return { kind: "notComparable", reason: diff.reason ?? null };
  const list = (
    id: SeoRunDiffList["id"],
    items: Issue[],
    total: number,
  ): SeoRunDiffList => ({
    id,
    items,
    total,
    more: Math.max(0, total - items.length),
  });
  const { issues, moves, moveCount } = diff.numbers;
  // Two checks that read only rankings have no issues to list: their moves say what changed, or that none moved.
  const ranksOnly = issues.from === null && issues.to === null;
  return {
    kind: "compared",
    lists: ranksOnly
      ? []
      : [
          list("new", diff.new, diff.newCount),
          list("fixed", diff.fixed, diff.fixedCount),
          list("stillOpen", diff.stillOpen, diff.stillOpenCount),
        ],
    notCheckedAgain: diff.notCheckedAgain,
    notCheckedBefore: diff.notCheckedBefore,
    issues:
      issues.from === null || issues.to === null
        ? null
        : { from: issues.from, to: issues.to },
    moves,
    moveCount,
    moreMoves: Math.max(0, moveCount - moves.length),
    rulebookChange: diff.rulebookChange ?? null,
  };
}
