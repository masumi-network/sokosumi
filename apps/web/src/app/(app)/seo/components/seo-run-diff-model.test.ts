import type { ProjectSeoRunDiff } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  seoRunDiffOf,
  seoRunDiffView,
  seoStopCheckId,
} from "./seo-run-diff-model";
import type { SeoStopNode } from "./seo-timeline-model";

const issue = (rowId: string) => ({
  rowId,
  title: `Title of ${rowId}`,
  pageUrl: "https://example.com/pricing",
  device: null,
  severity: "major" as const,
});

function diff(patch: Partial<ProjectSeoRunDiff> = {}): ProjectSeoRunDiff {
  return {
    from: new Date("2026-11-01T09:00:00Z"),
    to: new Date("2026-11-08T09:00:00Z"),
    comparable: true,
    new: [],
    newCount: 0,
    fixed: [],
    fixedCount: 0,
    stillOpen: [],
    stillOpenCount: 0,
    notCheckedAgain: 0,
    notCheckedBefore: 0,
    numbers: { issues: { from: 0, to: 0 }, moves: [], moveCount: 0 },
    ...patch,
  };
}

describe("seoRunDiffView", () => {
  it("keeps the total of a list that names only its first rows", () => {
    const view = seoRunDiffView(
      diff({
        new: [issue("A"), issue("B")],
        newCount: 9,
        fixed: [issue("C")],
        fixedCount: 1,
        numbers: {
          issues: { from: 3, to: 11 },
          moves: [
            {
              keyword: "seo tool",
              pageUrl: "https://example.com/pricing",
              device: "mobile",
              from: 4,
              to: 12,
            },
          ],
          moveCount: 6,
        },
      }),
    );
    if (view.kind !== "compared") throw new Error("expected a compared view");
    expect(
      view.lists.map(({ id, total, more, items }) => [
        id,
        items.length,
        total,
        more,
      ]),
    ).toEqual([
      ["new", 2, 9, 7],
      ["fixed", 1, 1, 0],
      ["stillOpen", 0, 0, 0],
    ]);
    expect(view.issues).toEqual({ from: 3, to: 11 });
    expect(view).toMatchObject({ moveCount: 6, moreMoves: 5 });
  });

  it("shows no list for two checks that are not comparable, and no issue numbers without a count", () => {
    expect(
      seoRunDiffView(
        diff({ comparable: false, reason: "rulebook", newCount: 4 }),
      ),
    ).toEqual({ kind: "notComparable", reason: "rulebook" });
    expect(
      seoRunDiffView(
        diff({
          numbers: { issues: { from: null, to: 2 }, moves: [], moveCount: 0 },
        }),
      ),
    ).toMatchObject({ kind: "compared", issues: null });
  });

  it("lists no issues between two checks that read only rankings, but keeps their moves", () => {
    const move = {
      keyword: "x402",
      pageUrl: "https://example.test/",
      device: "mobile" as const,
      from: 2,
      to: 10,
    };
    const view = (moveCount: number) =>
      seoRunDiffView(
        diff({
          numbers: {
            issues: { from: null, to: null },
            moves: moveCount ? [move] : [],
            moveCount,
          },
        }),
      );
    expect(view(1)).toMatchObject({ lists: [], moveCount: 1 });
    expect(view(0)).toMatchObject({ lists: { length: 3 } });
  });
});

describe("seoRunDiffOf", () => {
  it("finds the diff of one check and has none for a check without one", () => {
    const runDiff = diff();
    const run = {
      kind: "audit_full",
      observedAt: runDiff.to,
      issues: 0,
      seconds: null,
    };
    const workspace = {
      runs: [
        { ...run, observationId: "check-2", runDiff },
        { ...run, observationId: "check-1" },
      ],
    };
    expect(seoRunDiffOf(workspace, "check-2")).toBe(runDiff);
    expect(seoRunDiffOf(workspace, "check-1")).toBeNull();
    expect(seoRunDiffOf(workspace, undefined)).toBeNull();
    expect(seoRunDiffOf({}, "check-2")).toBeNull();
  });
});

describe("seoStopCheckId", () => {
  const node = (id: string, kind: string) =>
    ({ observation: { id, kind } }) as unknown as SeoStopNode;

  it("compares the newest page check of a stop, not a newer ranking check", () => {
    expect(
      seoStopCheckId([
        node("ranking", "rankings"),
        node("page", "page_check"),
        node("older", "page_check"),
      ]),
    ).toBe("page");
  });

  it("names no check of a stop that holds no page check", () => {
    expect(seoStopCheckId([node("ranking", "rankings")])).toBeUndefined();
  });
});
