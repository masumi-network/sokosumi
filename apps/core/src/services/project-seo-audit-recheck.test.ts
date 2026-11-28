import { describe, expect, it } from "vitest";

import type { PublicSeoPayload } from "@/helpers/project-seo-report";

import {
  type RecheckAudit,
  recheckSeoAuditActions,
} from "./project-seo-audit-recheck";

const PAGE = "https://example.test/pricing";
const KEY = "0123456789abcdef";
const FINAL = "https://example.test/pricing/";
type Check = PublicSeoPayload["checks"][number];

const row = (result: Check["result"], patch: Partial<Check> = {}): Check => ({
  rowId: "title",
  pageUrl: PAGE,
  device: "mobile",
  result,
  ruleKey: KEY,
  pageOnly: true,
  finalUrl: FINAL,
  ...patch,
});

function audit(
  id: string,
  day: number,
  checks: Check[],
  patch: Partial<PublicSeoPayload> = {},
): RecheckAudit {
  const observedAt = new Date(Date.UTC(2026, 10, day));
  return {
    id,
    observedAt,
    payload: {
      version: 1,
      kind: "audit_full",
      requestId: null,
      pageUrls: [PAGE],
      observedAt: observedAt.toISOString(),
      countryCode: "US",
      languageCode: "en",
      rulebookVersion: "r1",
      checks,
      keywords: [],
      competitors: [],
      findings: checks
        .filter((check) => check.result === "fired")
        .map((check) => ({
          id: `${check.rowId}:${check.device}`,
          pageUrl: check.pageUrl,
          device: check.device,
          rowId: check.rowId,
          title: check.rowId,
          severity: "major",
          evidence: [],
          sourceRef: id,
          observedAt: observedAt.toISOString(),
        })),
      actions: [
        {
          id: "1",
          pageUrl: PAGE,
          findingIds: checks
            .filter((check) => check.result === "fired")
            .map((check) => `${check.rowId}:${check.device}`),
          title: "Fix it",
          why: "why",
          effort: "low",
          expectedEffect: "more clicks",
          edit: null,
        },
      ],
      coverage: { checked: 0, skipped: 0, failed: 0 },
      notes: [],
      ...patch,
    },
  };
}

const recheck = (next: RecheckAudit, ...earlier: RecheckAudit[]) =>
  recheckSeoAuditActions(next, earlier).find(
    (item) => item.observationId === earlier[0]!.id,
  );

describe("recheckSeoAuditActions", () => {
  it("closes an action whose page-only rule now passes at the same final address", () => {
    const result = recheck(
      audit("n", 9, [row("pass")]),
      audit("e", 1, [row("fired")]),
    );
    expect(result).toMatchObject({ status: "done", actionId: "1" });
    expect(result?.pairs).toEqual([
      {
        pageUrl: PAGE,
        rowId: "title",
        device: "mobile",
        outcome: "closed",
        baselineObservationId: "e",
        baselineObservedAt: "2026-11-01T00:00:00.000Z",
        checkedObservationId: "n",
        ruleKey: KEY,
        finalUrl: FINAL,
      },
    ]);
  });

  it("ignores an out-of-market pass both as a recheck and as a baseline", () => {
    const earlier = audit("e", 1, [row("fired")]);
    const other = audit("x", 5, [row("pass", { outsideSiteMarket: true })]);
    const next = audit("n", 9, [row("pass")]);

    expect(recheck(other, earlier)?.status).toBe("not_compared");
    expect(recheck(next, earlier, other)?.pairs[0]).toMatchObject({
      outcome: "closed",
      baselineObservationId: earlier.id,
    });
  });

  it.each([
    ["a changed rule key", { ruleKey: "fedcba9876543210" }],
    ["no final address", { finalUrl: undefined }],
    ["another final address", { finalUrl: "https://example.test/new" }],
    ["a rule the render decided", { pageOnly: undefined }],
  ])("does not read a pass as a fix with %s", (_label, patch) => {
    const result = recheck(
      audit("n", 9, [row("pass", patch)]),
      audit("e", 1, [row("fired")]),
    );
    expect(result?.status).toBe("not_compared");
    expect(result?.pairs[0]?.outcome).toBe("not_compared");
  });

  it.each([
    ["the newer audit", "n"],
    ["the action's own audit", "e"],
  ])("closes no action when %s is a focused audit", (_label, focused) => {
    const kind = (id: string) =>
      id === focused ? { kind: "audit_lite" as const } : {};
    const result = recheck(
      audit("n", 9, [row("pass")], kind("n")),
      audit("e", 1, [row("fired")], kind("e")),
    );
    expect(result?.status).toBe("not_compared");
  });

  it("pairs no row of another market", () => {
    const result = recheck(
      audit("n", 9, [row("pass")], { countryCode: "DE" }),
      audit("e", 1, [row("fired")]),
    );
    expect(result?.status).toBe("not_compared");
    expect(result?.pairs[0]?.baselineObservationId).toBeNull();
  });

  it("keeps an action open while the same rule still fires", () => {
    expect(
      recheck(audit("n", 9, [row("fired")]), audit("e", 1, [row("fired")]))
        ?.status,
    ).toBe("open");
  });

  it("falls back to the rulebook for reports without rule keys", () => {
    const old = { ruleKey: undefined, pageOnly: undefined } as const;
    const earlier = audit("e", 1, [row("fired", old)]);
    expect(recheck(audit("n", 9, [row("fired", old)]), earlier)?.status).toBe(
      "open",
    );
    expect(
      recheck(
        audit("n", 9, [row("fired", old)], { rulebookVersion: "r2" }),
        earlier,
      )?.status,
    ).toBe("not_compared");
    // Without a rule key a pass never closes the action.
    expect(recheck(audit("n", 9, [row("pass", old)]), earlier)?.status).toBe(
      "not_compared",
    );
  });

  it("marks an action partial when only some of its rules closed", () => {
    const desktop = { device: "desktop" } as const;
    const result = recheck(
      audit("n", 9, [row("pass"), row("fired", desktop)]),
      audit("e", 1, [row("fired"), row("fired", desktop)]),
    );
    expect(result?.status).toBe("partial");
    expect(result?.pairs.map((pair) => pair.outcome)).toEqual([
      "closed",
      "still_fired",
    ]);
  });

  it("takes the newest read before the new audit as the baseline", () => {
    const earlier = audit("e", 1, [row("fired")]);
    // A blocked row is no read: the action's own audit stays the baseline.
    const blocked = recheck(
      audit("n", 9, [row("pass")]),
      earlier,
      audit("m", 5, [row("blocked")], { actions: [] }),
    );
    expect(blocked?.pairs[0]).toMatchObject({
      outcome: "closed",
      baselineObservationId: "e",
    });
    // A pass in between already read the fix: the new pass shows no change.
    const passed = recheck(
      audit("n", 9, [row("pass")]),
      earlier,
      audit("m", 5, [row("pass")], { actions: [] }),
    );
    expect(passed?.pairs[0]).toMatchObject({
      outcome: "not_compared",
      baselineObservationId: "m",
    });
  });

  it("leaves out skipped actions and audits not before the new one", () => {
    const next = audit("n", 9, [row("pass")]);
    const earlier = audit("e", 1, [row("fired")]);
    expect(
      recheckSeoAuditActions(next, [earlier], () => ({
        status: "done",
        pairs: [],
      })),
    ).toEqual([]);
    expect(
      recheckSeoAuditActions(next, [audit("later", 10, [row("fired")])]),
    ).toEqual([]);
  });

  it("cannot compare an action that names no finding", () => {
    const earlier = audit("e", 1, [row("fired")]);
    earlier.payload.actions[0]!.findingIds = [];
    expect(recheck(audit("n", 9, [row("pass")]), earlier)).toMatchObject({
      status: "not_compared",
      pairs: [],
    });
  });

  it("keeps a pair an earlier recheck closed until its rule fires again", () => {
    const desktop = { device: "desktop" } as const;
    const earlier = audit("e", 1, [row("fired"), row("fired", desktop)]);
    const middle = audit("m", 5, [row("pass"), row("fired", desktop)], {
      actions: [],
    });
    const first = recheck(middle, earlier);
    expect(first?.status).toBe("partial");
    const prior = () => first;
    // The mobile row passed at m, so n's pass alone shows no change; the stored close holds.
    const done = recheckSeoAuditActions(
      audit("n", 9, [row("pass"), row("pass", desktop)]),
      [earlier, middle],
      prior,
    )[0];
    expect(done?.status).toBe("done");
    expect(done?.pairs[0]).toMatchObject({
      outcome: "closed",
      checkedObservationId: "m",
    });
    const fired = recheckSeoAuditActions(
      audit("n", 9, [row("fired"), row("pass", desktop)]),
      [earlier, middle],
      prior,
    )[0];
    expect(fired?.pairs[0]?.outcome).toBe("still_fired");
  });
});
