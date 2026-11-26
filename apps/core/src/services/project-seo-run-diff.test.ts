import { describe, expect, it } from "vitest";

import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { SEO_RUN_DIFF_ITEMS } from "@/schemas/project-seo-run-diff.schema";

import { type SeoRunDiffSource, withSeoRunDiffs } from "./project-seo-run-diff";

const PAGE = "https://example.test/pricing";
const OTHER = "https://example.test/about";
type Device = "mobile" | "desktop";
type Row = { rowId: string; device?: Device; pageUrl?: string };

function payload(patch: Partial<PublicSeoPayload> = {}): PublicSeoPayload {
  return {
    version: 1,
    kind: "audit_full",
    requestId: null,
    pageUrls: [PAGE],
    observedAt: "2026-11-01T09:00:00.000Z",
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "r1",
    checks: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    coverage: { checked: 0, skipped: 0, failed: 0 },
    notes: [],
    ...patch,
  };
}
const check = (
  result: "pass" | "fired" | "not_checked",
  { rowId, device = "desktop", pageUrl = PAGE }: Row,
) => ({ rowId, pageUrl, device, result });
/** A failed rule as a check stores it: the fired check and its finding, whose id changes with every check. */
function failed(
  row: Row,
  severity: "critical" | "major" | "note" | "test" = "major",
) {
  const { rowId, device = "desktop", pageUrl = PAGE } = row;
  return {
    check: check("fired", row),
    finding: {
      id: `p${Math.random()}/${rowId}`,
      rowId,
      title: `Title of ${rowId}`,
      pageUrl,
      device,
      severity,
      evidence: [],
      sourceRef: "ref",
      observedAt: "2026-11-01T09:00:00.000Z",
    },
  };
}
/** A finding whose checklist row the check did not store. */
const findingOnly = (row: Row) => ({ finding: failed(row).finding });
function result(
  rows: Array<
    | ReturnType<typeof failed>
    | ReturnType<typeof findingOnly>
    | ReturnType<typeof check>
  >,
  patch: Partial<PublicSeoPayload> = {},
) {
  return payload({
    checks: rows.flatMap((row) =>
      "check" in row ? [row.check] : "finding" in row ? [] : [row],
    ),
    findings: rows.flatMap((row) => ("finding" in row ? [row.finding] : [])),
    ...patch,
  });
}
function source(
  day: number,
  data: PublicSeoPayload,
  patch: Partial<SeoRunDiffSource> = {},
): SeoRunDiffSource {
  return {
    id: `check-${day}`,
    kind: "audit_full",
    observedAt: new Date(Date.UTC(2026, 10, day, 9)),
    pageIds: ["page-1"],
    payload: data,
    ...patch,
  };
}
/** The diff of the newest check. Checks come newest first, as the projection reads them. */
function diffOf(sources: SeoRunDiffSource[], pageIds = ["page-1"]) {
  const runs = sources.map((item) => ({ observationId: item.id }));
  return withSeoRunDiffs(runs, {
    sources,
    selectedIds: new Set(pageIds),
    selectedUrls: new Set([PAGE, OTHER]),
  })[0].runDiff;
}
const rows = (items: Array<{ rowId: string }>) =>
  items.map((item) => item.rowId);

describe("withSeoRunDiffs", () => {
  it("names what is new, fixed and still open, although finding ids change with every check", () => {
    const diff = diffOf([
      source(
        8,
        result([
          failed({ rowId: "A" }, "critical"),
          failed({ rowId: "C" }),
          check("pass", { rowId: "B" }),
        ]),
      ),
      source(
        1,
        result([
          failed({ rowId: "A" }),
          failed({ rowId: "B" }),
          check("pass", { rowId: "C" }),
        ]),
      ),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      to: "2026-11-08T09:00:00.000Z",
      comparable: true,
      newCount: 1,
      fixedCount: 1,
      stillOpenCount: 1,
      notCheckedAgain: 0,
      notCheckedBefore: 0,
      numbers: { issues: { from: 2, to: 2 } },
    });
    expect(diff?.new).toEqual([
      {
        rowId: "C",
        title: "Title of C",
        pageUrl: PAGE,
        device: "desktop",
        severity: "major",
      },
    ]);
    expect(rows(diff?.fixed ?? [])).toEqual(["B"]);
    expect(rows(diff?.stillOpen ?? [])).toEqual(["A"]);
    expect(diff).not.toHaveProperty("reason");
  });

  it.each([
    ["rulebook", { rulebookVersion: "r2" }],
    ["market", { countryCode: "DE", languageCode: "de" }],
  ] as const)(
    "does not compare across another %s: no issue reads as new",
    (reason, patch) => {
      const diff = diffOf([
        source(
          8,
          result([failed({ rowId: "A" }), failed({ rowId: "B" })], patch),
        ),
        source(1, result([check("pass", { rowId: "A" })])),
      ]);
      expect(diff).toMatchObject({
        comparable: false,
        reason,
        new: [],
        newCount: 0,
        fixedCount: 0,
        stillOpenCount: 0,
        notCheckedAgain: 0,
        notCheckedBefore: 0,
      });
    },
  );

  it("compares with the earlier check of the same Market when checks of two Markets take turns", () => {
    const german = { countryCode: "DE", languageCode: "de" };
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(5, result([check("pass", { rowId: "A" })], german)),
      source(1, result([failed({ rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      comparable: true,
      stillOpenCount: 1,
      newCount: 0,
    });
  });

  it("compares with the earlier check of the same rulebook when another rulebook ran in between", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(5, result([], { rulebookVersion: "r2" })),
      source(1, result([failed({ rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      comparable: true,
      stillOpenCount: 1,
    });
  });

  it("reads a note as a rule the check read without an issue, on its device only", () => {
    const diff = diffOf([
      source(
        8,
        result([
          check("pass", { rowId: "A", device: "mobile" }),
          failed({ rowId: "B", device: "mobile" }),
          failed({ rowId: "C", device: "mobile" }),
          failed({ rowId: "D", device: "mobile" }, "test"),
        ]),
      ),
      source(
        1,
        result([
          failed({ rowId: "A", device: "mobile" }),
          failed({ rowId: "A", device: "desktop" }, "note"),
          failed({ rowId: "B", device: "mobile" }, "note"),
          check("pass", { rowId: "C", device: "desktop" }),
          check("fired", { rowId: "C", device: "mobile" }),
          failed({ rowId: "D", device: "mobile" }),
        ]),
      ),
    ]);
    // A: the desktop note was no failure, so the mobile pass fixes it. B: a note before, an issue now, is new.
    // C: the earlier pass was on another device. D: a finding that is not a note does not say the rule was read.
    expect(rows(diff?.fixed ?? [])).toEqual(["A"]);
    expect(rows(diff?.new ?? [])).toEqual(["B"]);
    expect(diff).toMatchObject({ notCheckedBefore: 1, notCheckedAgain: 1 });
  });

  it("never counts an issue as fixed when the later check did not read its rule again", () => {
    const diff = diffOf([
      source(
        8,
        result([
          check("not_checked", { rowId: "B" }),
          check("pass", { rowId: "D", device: "desktop" }),
          check("pass", { rowId: "E", device: "desktop" }),
          check("pass", { rowId: "F", device: "mobile" }),
          check("fired", { rowId: "F", device: "desktop" }),
        ]),
      ),
      source(
        1,
        result([
          failed({ rowId: "A" }),
          failed({ rowId: "B" }),
          failed({ rowId: "D", device: "mobile" }),
          findingOnly({ rowId: "E", device: "mobile" }),
          failed({ rowId: "F", device: "mobile" }),
        ]),
      ),
    ]);
    // A is absent, B was not checked, D and E passed only on the device that never failed, and F fired on another
    // device with no finding to say how bad it is.
    expect(diff).toMatchObject({
      comparable: true,
      fixed: [],
      fixedCount: 0,
      notCheckedAgain: 5,
      numbers: { issues: { from: 5, to: 0 } },
    });
  });

  it("counts an issue as fixed when the later check read its rule again and left a note only", () => {
    const diff = diffOf([
      source(
        8,
        result([
          failed({ rowId: "A" }, "note"),
          failed({ rowId: "B", device: "mobile" }, "note"),
        ]),
      ),
      source(
        1,
        result([
          failed({ rowId: "A" }),
          failed({ rowId: "B", device: "mobile" }),
          failed({ rowId: "B", device: "desktop" }),
        ]),
      ),
    ]);
    // A was read again on its device. B was read again on mobile only, so its desktop failure is not known fixed.
    expect(rows(diff?.fixed ?? [])).toEqual(["A"]);
    expect(diff).toMatchObject({ fixedCount: 1, notCheckedAgain: 1 });
  });

  it("does not count an issue as new when the earlier check did not read its rule", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(1, result([check("not_checked", { rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({
      comparable: true,
      newCount: 0,
      new: [],
      notCheckedBefore: 1,
    });
  });

  it("counts a rule that fails on mobile and on desktop as one issue, as the issue count does", () => {
    const both = [
      failed({ rowId: "A", device: "mobile" }),
      failed({ rowId: "A", device: "desktop" }),
    ];
    const open = diffOf([source(8, result(both)), source(1, result(both))]);
    expect(open).toMatchObject({ stillOpenCount: 1 });
    expect(open?.stillOpen[0].device).toBeNull();
    // Fixed on one device only: the issue of that page is still open, not fixed.
    const half = diffOf([
      source(
        8,
        result([
          check("pass", { rowId: "A", device: "mobile" }),
          failed({ rowId: "A", device: "desktop" }),
        ]),
      ),
      source(1, result(both)),
    ]);
    expect(half).toMatchObject({ stillOpenCount: 1, fixedCount: 0 });
    expect(half?.stillOpen[0].device).toBe("desktop");
    const fixed = diffOf([
      source(
        8,
        result([
          check("pass", { rowId: "A", device: "mobile" }),
          check("pass", { rowId: "A", device: "desktop" }),
        ]),
      ),
      source(1, result(both)),
    ]);
    expect(fixed).toMatchObject({ fixedCount: 1, notCheckedAgain: 0 });
  });

  it("gives no diff for a check that read only some of the selected pages", () => {
    const partial = diffOf(
      [
        source(8, result([failed({ rowId: "A" })])),
        source(1, result([check("pass", { rowId: "A" })]), {
          pageIds: ["page-1", "page-2"],
        }),
      ],
      ["page-1", "page-2"],
    );
    expect(partial).toMatchObject({
      comparable: false,
      reason: "pages",
      newCount: 0,
      new: [],
    });
    // An earlier check of some pages is no base either: the full check before it is.
    const skipped = diffOf(
      [
        source(8, result([failed({ rowId: "A" })]), {
          pageIds: ["page-1", "page-2"],
        }),
        source(5, result([failed({ rowId: "A" })])),
        source(1, result([check("pass", { rowId: "A" })]), {
          pageIds: ["page-1", "page-2"],
        }),
      ],
      ["page-1", "page-2"],
    );
    expect(skipped).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      comparable: true,
      newCount: 1,
    });
  });

  it("leaves out notes and pages outside the selection, and the first check of a kind has no diff", () => {
    const sources = [
      source(
        8,
        result([
          failed({ rowId: "N" }, "note"),
          failed({ rowId: "X", pageUrl: "https://example.test/other" }),
        ]),
      ),
      source(
        5,
        result([check("pass", { rowId: "N" })], { kind: "page_check" }),
        { kind: "page_check" },
      ),
      source(
        1,
        result([
          check("pass", { rowId: "N" }),
          check("pass", { rowId: "X", pageUrl: "https://example.test/other" }),
        ]),
      ),
    ];
    expect(diffOf(sources)).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      newCount: 0,
    });
    expect(diffOf(sources.slice(1))).toBeUndefined();
  });

  it("bounds each list, keeps the total and lists the worst issues first", () => {
    const many = Array.from({ length: SEO_RUN_DIFF_ITEMS + 3 }, (_, index) =>
      failed({ rowId: `R${index}` }, index === 7 ? "critical" : "major"),
    );
    const diff = diffOf([
      source(8, result(many)),
      source(
        1,
        result(many.map((row) => check("pass", { rowId: row.check.rowId }))),
      ),
    ]);
    expect(diff?.new).toHaveLength(SEO_RUN_DIFF_ITEMS);
    expect(diff?.newCount).toBe(SEO_RUN_DIFF_ITEMS + 3);
    expect(diff?.new[0].rowId).toBe("R7");
  });
});
