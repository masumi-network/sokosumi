import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import {
  buildActivityStats,
  featuredCoworkerRole,
  hasReportableActivity,
  resolveFeaturedCoworker,
  selectStripCoworkers,
  toStripCoworker,
} from "../landing-content";

function buildCoworker(overrides: Partial<Coworker> & { id: string }) {
  return {
    avatar: null,
    caption: null,
    description: "",
    name: overrides.id,
    slug: overrides.id,
    useCase: "",
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

describe("featuredCoworkerRole", () => {
  const elenaPitch = "Project Manager - you can give her any task";

  it("uses product copy for Elena", () => {
    const elena = buildCoworker({
      id: "elena",
      slug: "elena",
      caption: "Strategy",
    });
    expect(featuredCoworkerRole(elena, elenaPitch)).toBe(elenaPitch);
  });

  it("uses caption for a non-Elena featured coworker", () => {
    const hannah = buildCoworker({
      id: "hannah",
      slug: "hannah",
      caption: "Research",
    });
    expect(featuredCoworkerRole(hannah, elenaPitch)).toBe("Research");
  });

  it("returns null when a non-Elena featured coworker has no caption", () => {
    const hannah = buildCoworker({ id: "hannah", slug: "hannah" });
    expect(featuredCoworkerRole(hannah, elenaPitch)).toBeNull();
  });
});

describe("toStripCoworker", () => {
  it("maps a non-empty caption to title", () => {
    const strip = toStripCoworker(
      buildCoworker({
        id: "hannah",
        caption: "Research lead",
        useCase: "Should not win",
      }),
    );
    expect(strip.title).toBe("Research lead");
  });

  it("falls back to useCase when caption is empty", () => {
    const strip = toStripCoworker(
      buildCoworker({
        id: "alex",
        caption: "   ",
        useCase: "Data analysis",
      }),
    );
    expect(strip.title).toBe("Data analysis");
  });

  it("returns null title when caption and useCase are empty", () => {
    const strip = toStripCoworker(
      buildCoworker({ id: "blake", caption: "", useCase: "  " }),
    );
    expect(strip.title).toBeNull();
  });
});

describe("selectStripCoworkers", () => {
  const featured = buildCoworker({ id: "elena", slug: "elena" });
  const others = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
    buildCoworker({ id }),
  );

  it("never includes the featured coworker", () => {
    const picked = selectStripCoworkers([featured, ...others], featured);
    expect(picked.map((c) => c.id)).not.toContain("elena");
  });

  it("returns every non-featured coworker", () => {
    const picked = selectStripCoworkers([featured, ...others], featured);
    expect(picked.map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });

  it("returns an empty list when nothing is featured", () => {
    expect(selectStripCoworkers(others, null)).toEqual([]);
  });

  it("returns an empty list for a lone featured coworker", () => {
    expect(selectStripCoworkers([featured], featured)).toEqual([]);
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

  it("still lists metrics when lastVisitAt is null (no sessions)", () => {
    // Window is session-derived; null lastVisitAt only means no sessions, not
    // "hide chips". Chips follow non-zero metrics only.
    const stats = buildActivityStats(
      buildSummary({
        awaitingInput: 3,
        completed: 2,
        lastVisitAt: null,
        basis: "recent",
        since: new Date("2026-08-10T09:00:00.000Z"),
      }),
      false,
      fakeTranslator,
    );
    expect(stats).toEqual([
      'stats.completed:{"count":2}',
      'stats.awaiting:{"count":3}',
    ]);
  });
});

describe("hasReportableActivity", () => {
  it("is false for a failed summary", () => {
    expect(hasReportableActivity(null)).toBe(false);
  });

  it("is false for a brand-new account with nothing to report", () => {
    expect(hasReportableActivity(buildSummary())).toBe(false);
  });

  it.each([
    ["completed", { completed: 1 }],
    ["workedMinutes", { workedMinutes: 1 }],
    ["awaitingInput", { awaitingInput: 1 }],
    ["createdByOtherHumans", { createdByOtherHumans: 1 }],
  ])("is true when %s is non-zero", (_label, overrides) => {
    expect(hasReportableActivity(buildSummary(overrides))).toBe(true);
  });
});
