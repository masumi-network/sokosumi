import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import {
  buildActivityStats,
  hasReportableActivity,
  resolveFeaturedCoworker,
  selectStripCoworkers,
} from "../landing-content";

function buildCoworker(overrides: Partial<Coworker> & { id: string }) {
  return {
    avatar: null,
    caption: null,
    name: overrides.id,
    slug: overrides.id,
    ...overrides,
  } as Coworker;
}

const RETURNING_VISIT_AT = new Date("2026-08-10T09:00:00.000Z");

function buildSummary(
  overrides: Partial<TaskActivitySummary> = {},
): TaskActivitySummary {
  return {
    awaitingInput: 0,
    basis: "lastVisit",
    completed: 0,
    createdByOtherHumans: 0,
    lastVisitAt: RETURNING_VISIT_AT,
    since: RETURNING_VISIT_AT,
    workedMinutes: 0,
    ...overrides,
  };
}

/** Mirrors next-intl's shape closely enough to assert which keys are used. */
function fakeTranslator(key: string, values?: Record<string, number | string>) {
  return values ? `${key}:${JSON.stringify(values)}` : key;
}

describe("resolveFeaturedCoworker", () => {
  it("prefers Elena regardless of list order or slug casing", () => {
    const coworkers = [
      buildCoworker({ id: "hannah" }),
      buildCoworker({ id: "elena-id", slug: "Elena" }),
      buildCoworker({ id: "alex" }),
    ];

    expect(resolveFeaturedCoworker(coworkers)?.id).toBe("elena-id");
  });

  it("falls back to the default coworker when Elena is not available", () => {
    // `scope=available` is whitelist ∪ granted access, so Elena can be absent.
    const coworkers = [
      buildCoworker({ id: "hannah" }),
      buildCoworker({ id: "alex" }),
    ];

    expect(resolveFeaturedCoworker(coworkers)).not.toBeNull();
  });

  it("returns null when there are no coworkers at all", () => {
    expect(resolveFeaturedCoworker([])).toBeNull();
  });
});

describe("selectStripCoworkers", () => {
  const featured = buildCoworker({ id: "elena", slug: "elena" });
  const others = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
    buildCoworker({ id }),
  );

  it("never includes the featured coworker", () => {
    const picked = selectStripCoworkers([featured, ...others], featured, 6);
    expect(picked.map((c) => c.id)).not.toContain("elena");
  });

  it("drops the odd one out so the flanks balance", () => {
    // Five candidates, max six: an odd count would shove the featured face off
    // the optical centre, so it takes four.
    const five = others.slice(0, 5);
    const picked = selectStripCoworkers([featured, ...five], featured, 6);
    expect(picked).toHaveLength(4);
  });

  it("caps at max even when more coworkers exist", () => {
    const picked = selectStripCoworkers([featured, ...others], featured, 4);
    expect(picked).toHaveLength(4);
  });

  it("returns an empty list when nothing is featured", () => {
    expect(selectStripCoworkers(others, null, 6)).toEqual([]);
  });

  it("never returns a negative slice for a lone coworker", () => {
    expect(selectStripCoworkers([featured], featured, 6)).toEqual([]);
  });
});

describe("buildActivityStats", () => {
  it("omits every zero metric in a personal workspace", () => {
    const stats = buildActivityStats(buildSummary(), false, fakeTranslator);
    expect(stats).toEqual([]);
  });

  it("lists completed, worked, and awaiting in display order", () => {
    const stats = buildActivityStats(
      buildSummary({ awaitingInput: 2, completed: 4, workedMinutes: 47 }),
      false,
      fakeTranslator,
    );

    expect(stats).toEqual([
      'stats.completed:{"count":4}',
      'stats.worked:{"minutes":47}',
      'stats.awaiting:{"count":2}',
    ]);
  });

  it("keeps the teammates chip at zero inside an organization", () => {
    // "what my teammates added" is a question the row should answer, not omit.
    const stats = buildActivityStats(buildSummary(), true, fakeTranslator);
    expect(stats).toEqual(['stats.byTeammates:{"count":0}']);
  });

  it("returns nothing when the summary could not be loaded", () => {
    expect(buildActivityStats(null, true, fakeTranslator)).toEqual([]);
  });

  it("returns nothing on a first visit even when awaiting-input exists", () => {
    // Spec: first visit is greeting-only — no "while you were away" chips.
    const stats = buildActivityStats(
      buildSummary({
        awaitingInput: 3,
        completed: 2,
        lastVisitAt: null,
        basis: "recent",
        since: new Date("2026-08-10T09:00:00.000Z"),
      }),
      true,
      fakeTranslator,
    );
    expect(stats).toEqual([]);
  });
});

describe("hasReportableActivity", () => {
  it("is false for a failed summary", () => {
    expect(hasReportableActivity(null)).toBe(false);
  });

  it("is false for a brand-new account with nothing to report", () => {
    expect(hasReportableActivity(buildSummary())).toBe(false);
  });

  it("is false on a first visit even when metrics are non-zero", () => {
    expect(
      hasReportableActivity(
        buildSummary({
          awaitingInput: 1,
          completed: 1,
          lastVisitAt: null,
          basis: "recent",
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["completed", { completed: 1 }],
    ["workedMinutes", { workedMinutes: 1 }],
    ["awaitingInput", { awaitingInput: 1 }],
    ["createdByOtherHumans", { createdByOtherHumans: 1 }],
  ])(
    "is true when %s is non-zero for a returning visit",
    (_label, overrides) => {
      expect(hasReportableActivity(buildSummary(overrides))).toBe(true);
    },
  );
});
