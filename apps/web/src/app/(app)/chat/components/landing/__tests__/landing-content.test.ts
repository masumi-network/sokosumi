import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import {
  buildActivityStats,
  compareCoworkerRank,
  orderStripCoworkers,
  resolveFeaturedCoworker,
  resolveLandingGreetingName,
  toStripCoworker,
} from "../landing-content";

function buildCoworker(overrides: Partial<Coworker> & { id: string }) {
  return {
    avatar: undefined,
    caption: undefined,
    description: "",
    name: overrides.id,
    slug: overrides.id,
    useCase: "",
    ...overrides,
  } as Coworker;
}

describe("resolveLandingGreetingName", () => {
  it("uses the given name only", () => {
    expect(resolveLandingGreetingName("Andreas Schmidt")).toBe("Andreas");
  });

  it("returns null when blank so the nameless greeting shows", () => {
    expect(resolveLandingGreetingName(null)).toBeNull();
    expect(resolveLandingGreetingName("   ")).toBeNull();
  });
});

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

describe("compareCoworkerRank", () => {
  it("ranks higher priority first", () => {
    expect(
      compareCoworkerRank(
        { priority: 1, slug: "a" },
        { priority: 10, slug: "b" },
      ),
    ).toBeGreaterThan(0);
  });

  it("breaks priority ties by slug", () => {
    expect(
      compareCoworkerRank(
        { priority: 0, slug: "alex" },
        { priority: 0, slug: "elena" },
      ),
    ).toBeLessThan(0);
  });

  it("treats a missing priority as zero", () => {
    expect(
      compareCoworkerRank({ slug: "alex" }, { priority: 3, slug: "elena" }),
    ).toBeGreaterThan(0);
  });
});

describe("resolveFeaturedCoworker", () => {
  it("prefers the coworker with the highest priority regardless of list order", () => {
    const coworkers = [
      buildCoworker({
        id: "hannah",
        slug: "hannah",
        priority: 2,
      }),
      buildCoworker({
        id: "elena-id",
        slug: "elena",
        priority: 1,
      }),
      buildCoworker({ id: "alex", slug: "alex", priority: 8 }),
    ];

    expect(resolveFeaturedCoworker(coworkers)?.id).toBe("alex");
  });

  it("does not prefer Elena when every priority is zero", () => {
    const coworkers = [
      buildCoworker({ id: "hannah", slug: "hannah" }),
      buildCoworker({ id: "elena-id", slug: "elena" }),
      buildCoworker({ id: "alex", slug: "alex" }),
    ];

    expect(resolveFeaturedCoworker(coworkers)?.id).toBe("alex");
  });

  it("returns null when there are no coworkers at all", () => {
    expect(resolveFeaturedCoworker([])).toBeNull();
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

  it("keeps Serviceplan .webp avatar URLs for the strip (Jamal/Maya)", () => {
    const jamalUrl =
      "https://usecases.serviceplan-agents.com/images/jamal.webp";
    const strip = toStripCoworker(
      buildCoworker({
        id: "jamal-id",
        slug: "jamal",
        avatar: jamalUrl,
      }),
    );
    expect(strip.imageUrl).toBe(jamalUrl);
  });

  it("keeps avatars from any *.serviceplan-agents.com subdomain", () => {
    const fooUrl = "https://foo.serviceplan-agents.com/images/maya.webp";
    const strip = toStripCoworker(
      buildCoworker({
        id: "maya-id",
        slug: "maya",
        avatar: fooUrl,
      }),
    );
    expect(strip.imageUrl).toBe(fooUrl);
  });

  it("keeps .webp on already-allowed blob hosts", () => {
    const blobWebp =
      "https://yhpsw8jlcoagsrkq.public.blob.vercel-storage.com/coworkers/maya.webp";
    const strip = toStripCoworker(
      buildCoworker({
        id: "maya-id",
        slug: "maya",
        avatar: blobWebp,
      }),
    );
    expect(strip.imageUrl).toBe(blobWebp);
  });

  it("still nulls avatars on unknown hosts so next/image cannot crash the page", () => {
    const strip = toStripCoworker(
      buildCoworker({
        id: "evil",
        slug: "evil",
        avatar: "https://evil.example.com/face.webp",
      }),
    );
    expect(strip.imageUrl).toBeNull();
  });
});

describe("orderStripCoworkers", () => {
  const featured = buildCoworker({ id: "elena", slug: "elena" });
  const others = ["a", "b", "c", "d", "e", "f", "g"].map((id) =>
    buildCoworker({ id }),
  );

  it("places the featured coworker at the exact middle for an odd count", () => {
    // ranks a,b,c,d by slug → diamond [c, a, featured, b, d]
    const four = others.slice(0, 4);
    const ordered = orderStripCoworkers([featured, ...four], featured);
    expect(ordered.map((c) => c.id)).toEqual(["c", "a", "elena", "b", "d"]);
    expect(ordered).toHaveLength(5);
  });

  it("drops the lowest-priority coworker when the catalog would be even", () => {
    // featured + a,b,c = 4 → drop c (last by slug) → [a, elena, b]
    const three = others.slice(0, 3);
    const ordered = orderStripCoworkers([featured, ...three], featured);
    expect(ordered.map((c) => c.id)).toEqual(["a", "elena", "b"]);
    expect(ordered).toHaveLength(3);
    expect(ordered.map((c) => c.id)).not.toContain("c");
  });

  it("drops the last rank from an even catalog so the featured face is centred", () => {
    // featured + 7 others = 8 → drop g → diamond of 7
    const ordered = orderStripCoworkers([featured, ...others], featured);
    expect(ordered).toHaveLength(7);
    expect(ordered.length % 2).toBe(1);
    expect(ordered[Math.floor(ordered.length / 2)]?.id).toBe("elena");
    expect(ordered.map((c) => c.id)).toEqual([
      "e",
      "c",
      "a",
      "elena",
      "b",
      "d",
      "f",
    ]);
    expect(ordered.map((c) => c.id)).not.toContain("g");
  });

  it("returns an empty list when nothing is featured", () => {
    expect(orderStripCoworkers(others, null)).toEqual([]);
  });

  it("returns a lone featured coworker alone", () => {
    expect(orderStripCoworkers([featured], featured).map((c) => c.id)).toEqual([
      "elena",
    ]);
  });

  it("drops the other face when the catalog is two so the lead stays centred", () => {
    const other = buildCoworker({ id: "a", slug: "a" });
    const ordered = orderStripCoworkers([featured, other], featured);
    expect(ordered.map((c) => c.id)).toEqual(["elena"]);
  });

  it("orders the flanks by priority: 2nd left, 3rd right, lowest on the edge", () => {
    const lead = buildCoworker({
      id: "alex",
      slug: "alex",
      priority: 20,
    });
    const second = buildCoworker({
      id: "hannah",
      slug: "hannah",
      priority: 5,
    });
    const lowest = buildCoworker({
      id: "blake",
      slug: "blake",
      priority: 1,
    });

    const ordered = orderStripCoworkers([lowest, lead, second], lead);
    expect(ordered.map((c) => c.id)).toEqual(["hannah", "alex", "blake"]);
    expect(ordered.length % 2).toBe(1);
  });
});

describe("buildActivityStats", () => {
  it("still emits zero chips in a personal workspace with no activity", () => {
    const stats = buildActivityStats(buildSummary(), false, fakeTranslator);
    expect(stats).toEqual([
      'stats.completed:{"count":0}',
      'stats.worked:{"minutes":0}',
      'stats.awaiting:{"count":0}',
    ]);
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
    expect(stats).toEqual([
      'stats.completed:{"count":0}',
      'stats.worked:{"minutes":0}',
      'stats.awaiting:{"count":0}',
      'stats.byTeammates:{"count":0}',
    ]);
  });

  it("still emits zero chips when the summary could not be loaded", () => {
    expect(buildActivityStats(null, true, fakeTranslator)).toEqual([
      'stats.completed:{"count":0}',
      'stats.worked:{"minutes":0}',
      'stats.awaiting:{"count":0}',
      'stats.byTeammates:{"count":0}',
    ]);
  });

  it("still lists metrics when lastVisitAt is null (no sessions)", () => {
    // Window is session-derived; null lastVisitAt only means no sessions, not
    // "hide chips". Chips always render, including zeros for idle metrics.
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
      'stats.worked:{"minutes":0}',
      'stats.awaiting:{"count":3}',
    ]);
  });
});
