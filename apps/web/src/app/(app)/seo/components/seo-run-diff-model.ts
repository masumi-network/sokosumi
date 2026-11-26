import type {
  ProjectSeoRunDiff,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";

type Issue = ProjectSeoRunDiff["new"][number];

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
  return {
    kind: "compared",
    lists: [
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
  };
}
