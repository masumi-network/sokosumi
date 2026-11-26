import { describe, expect, it } from "vitest";

import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { SEO_RUN_DIFF_ITEMS } from "@/schemas/project-seo-run-diff.schema";

import { type SeoRunDiffSource, withSeoRunDiffs } from "./project-seo-run-diff";

const PAGE = "https://example.test/pricing";
const OTHER = "https://example.test/about";
const URLS: Record<string, string> = { "page-1": PAGE, "page-2": OTHER };
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
  result: "pass" | "fired" | "blocked" | "not_checked",
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
      device: device as Device | null,
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
    selectedUrls: new Set(pageIds.map((id) => URLS[id])),
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
      // The same Market with another rulebook is closer than another Market, and still no match.
      source(
        3,
        result([check("pass", { rowId: "A" })], { rulebookVersion: "r2" }),
      ),
      source(1, result([failed({ rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      comparable: true,
      stillOpenCount: 1,
      newCount: 0,
    });
  });

  it("pairs with the check of the same Market before one of another Market, where no check matches", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(
        5,
        result([check("pass", { rowId: "A" })], {
          countryCode: "DE",
          languageCode: "de",
        }),
      ),
      source(
        3,
        result([check("pass", { rowId: "A" })], { rulebookVersion: "r2" }),
      ),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-03T09:00:00.000Z",
      comparable: false,
      reason: "rulebook",
    });
  });

  it("compares with the earlier check of the same rulebook when another rulebook ran in between", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(
        5,
        result([check("pass", { rowId: "A" })], { rulebookVersion: "r2" }),
      ),
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
          failed({ rowId: "E", device: "mobile" }),
          check("fired", { rowId: "E", device: "desktop" }),
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
          check("pass", { rowId: "E", device: "mobile" }),
        ]),
      ),
    ]);
    // E fails on mobile by its finding and fired on desktop without one: no single device names it.
    expect(diff?.new.map((item) => item.device)).toEqual(["mobile", null]);
    // A: the desktop note was no failure, so the mobile pass fixes it. B: a note before, an issue now, is new.
    // C: the earlier pass was on another device. D: a finding that is not a note does not say the rule was read.
    expect(rows(diff?.fixed ?? [])).toEqual(["A"]);
    expect(rows(diff?.new ?? [])).toEqual(["B", "E"]);
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
          check("fired", { rowId: "G" }),
          check("pass", { rowId: "G" }),
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
          failed({ rowId: "G" }),
        ]),
      ),
    ]);
    // A is absent, B was not checked, D and E passed only on the device that never failed, and F fired on another
    // device with no finding to say how bad it is. G has a row that passed and a row that fired on one device.
    expect(diff).toMatchObject({
      comparable: true,
      fixed: [],
      fixedCount: 0,
      notCheckedAgain: 6,
      numbers: { issues: { from: 6, to: 0 } },
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
      source(
        1,
        result([
          check("not_checked", { rowId: "A" }),
          check("pass", { rowId: "B" }),
        ]),
      ),
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
    const other = check("pass", { rowId: "Z", pageUrl: OTHER });
    const partial = diffOf(
      [
        source(8, result([failed({ rowId: "A" })])),
        source(1, result([check("pass", { rowId: "A" }), other]), {
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
        source(8, result([failed({ rowId: "A" }), other]), {
          pageIds: ["page-1", "page-2"],
        }),
        source(5, result([failed({ rowId: "A" })])),
        source(1, result([check("pass", { rowId: "A" }), other]), {
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
    // A check that names a page but only blocked its rules there did not read it: the full check before it is the base.
    const blocked = diffOf(
      [
        source(8, result([failed({ rowId: "A" }), other]), {
          pageIds: ["page-1", "page-2"],
        }),
        source(
          5,
          result([
            failed({ rowId: "A" }),
            check("blocked", { rowId: "Z", pageUrl: OTHER }),
          ]),
          { pageIds: ["page-1", "page-2"] },
        ),
        source(1, result([check("pass", { rowId: "A" }), other]), {
          pageIds: ["page-1", "page-2"],
        }),
      ],
      ["page-1", "page-2"],
    );
    expect(blocked).toMatchObject({
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

const ranked = (position: number | null) => ({
  keyword: "x402",
  pageUrl: PAGE,
  device: "mobile" as const,
  position,
  positionStatus:
    position === null ? ("unavailable" as const) : ("ranked" as const),
  checkedResults: 20,
  sourceRef: "ref",
  observedAt: "2026-11-01T09:00:00.000Z",
});
const lite = (position: number | null) =>
  payload({ kind: "audit_lite", keywords: [ranked(position)] });

describe("withSeoRunDiffs edge cases", () => {
  it("compares the ranks of two checks of page rules that read rankings only", () => {
    const diff = diffOf([
      source(8, lite(8), { kind: "audit_lite" }),
      source(1, lite(2), { kind: "audit_lite" }),
    ]);
    expect(diff).toMatchObject({ comparable: true, numbers: { moveCount: 1 } });
  });

  it("pairs past a page check that stored no rows", () => {
    const diff = diffOf([
      source(3, result([failed({ rowId: "B" })])),
      source(2, result([])),
      source(1, result([check("pass", { rowId: "B" })])),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      newCount: 1,
    });
  });

  it("counts no new issue where the earlier check passed a rule on a device it also fired on", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "B" })])),
      source(
        1,
        result([check("pass", { rowId: "B" }), check("fired", { rowId: "B" })]),
      ),
    ]);
    expect(diff).toMatchObject({ newCount: 0, notCheckedBefore: 1 });
  });

  it("pairs with a shown check before a hidden check of the same time", () => {
    const latest = source(8, result([failed({ rowId: "B" })]));
    const shown = source(1, result([check("pass", { rowId: "B" })]));
    const hidden = source(1, result([failed({ rowId: "B" })]), {
      id: "hidden",
    });
    const [run] = withSeoRunDiffs(
      [{ observationId: latest.id }, { observationId: shown.id }],
      {
        sources: [latest, shown],
        diffBaselines: [hidden],
        selectedIds: new Set(["page-1"]),
        selectedUrls: new Set([PAGE]),
      },
    );
    expect(run.runDiff).toMatchObject({ newCount: 1, stillOpenCount: 0 });
  });

  it("pairs past a check of ranks that read none", () => {
    const diff = diffOf([
      source(8, lite(11), { kind: "audit_lite" }),
      source(5, lite(null), { kind: "audit_lite" }),
      source(1, lite(2), { kind: "audit_lite" }),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      numbers: { moveCount: 1 },
    });
  });

  it("pairs past a page check that stored only a note", () => {
    const diff = diffOf([
      source(8, result([failed({ rowId: "A" })])),
      source(5, result([{ finding: failed({ rowId: "A" }, "note").finding }])),
      source(1, result([failed({ rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      newCount: 0,
      stillOpenCount: 1,
    });
  });

  it("reads a check of another kind by the pages it names, whatever its rows cover", () => {
    const links = (day: number) =>
      source(day, result([check("pass", { rowId: "L" })], { kind: "links" }), {
        kind: "links",
        pageIds: ["page-1", "page-2"],
      });
    expect(diffOf([links(8), links(1)], ["page-1", "page-2"])).toMatchObject({
      comparable: true,
      from: "2026-11-01T09:00:00.000Z",
    });
  });

  it("pairs past a check of ranks whose usable rank is on another page", () => {
    const diff = diffOf([
      source(8, lite(15), { kind: "audit_lite" }),
      source(
        5,
        payload({
          kind: "audit_lite",
          keywords: [ranked(null), { ...ranked(5), pageUrl: OTHER }],
        }),
        { kind: "audit_lite" },
      ),
      source(1, lite(5), { kind: "audit_lite" }),
    ]);
    expect(diff).toMatchObject({
      from: "2026-11-01T09:00:00.000Z",
      numbers: { moveCount: 1 },
    });
  });

  it("counts no new issue from a finding without a device where only one failed device was clear before", () => {
    const anyDevice = {
      ...failed({ rowId: "A", device: "mobile" }),
      finding: { ...failed({ rowId: "A" }).finding, device: null },
    };
    const diff = diffOf([
      source(8, result([anyDevice, check("fired", { rowId: "A" })])),
      source(1, result([check("pass", { rowId: "A", device: "mobile" })])),
    ]);
    expect(diff).toMatchObject({ newCount: 0, notCheckedBefore: 1 });
  });

  it("counts a finding without a device as new where every device it fired on was clear before", () => {
    const anyDevice = {
      ...failed({ rowId: "A" }),
      finding: { ...failed({ rowId: "A" }).finding, device: null },
    };
    const diff = diffOf([
      source(8, result([anyDevice])),
      source(1, result([check("pass", { rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({ newCount: 1, notCheckedBefore: 0 });
  });

  it("counts no new issue from a finding without a device where a note answers the row of a device not read before", () => {
    const anyDevice = {
      ...failed({ rowId: "A", device: "mobile" }),
      finding: { ...failed({ rowId: "A" }).finding, device: null },
    };
    const diff = diffOf([
      source(8, result([anyDevice, failed({ rowId: "A" }, "note")])),
      source(1, result([check("pass", { rowId: "A", device: "mobile" })])),
    ]);
    expect(diff).toMatchObject({ newCount: 0, notCheckedBefore: 1 });
  });

  it("counts no new issue from a finding without a device or a row that fired", () => {
    const diff = diffOf([
      source(
        8,
        result([
          { finding: { ...failed({ rowId: "A" }).finding, device: null } },
          check("pass", { rowId: "B" }),
        ]),
      ),
      source(1, result([check("pass", { rowId: "A" })])),
    ]);
    expect(diff).toMatchObject({ newCount: 0, notCheckedBefore: 1 });
  });

  it("gives no issue totals to checks that measured no page rule", () => {
    const diff = diffOf([
      source(8, lite(8), { kind: "audit_lite" }),
      source(1, lite(2), { kind: "audit_lite" }),
    ]);
    expect(diff?.numbers.issues).toEqual({ from: null, to: null });
  });

  it("counts no new issue on a device the earlier check did not read, beside a bare row on one it did", () => {
    const diff = diffOf([
      source(
        8,
        result([
          failed({ rowId: "B", device: "mobile" }),
          check("fired", { rowId: "B" }),
        ]),
      ),
      source(1, result([check("pass", { rowId: "B" })])),
    ]);
    expect(diff).toMatchObject({ newCount: 0, notCheckedBefore: 1 });
  });

  it("counts no fix where one note answers only one of two rows that fired", () => {
    const diff = diffOf([
      source(
        8,
        result([
          failed({ rowId: "B" }, "note"),
          check("fired", { rowId: "B" }),
        ]),
      ),
      source(1, result([failed({ rowId: "B" })])),
    ]);
    expect(diff).toMatchObject({ fixedCount: 0, notCheckedAgain: 1 });
  });
});
