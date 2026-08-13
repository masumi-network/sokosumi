import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";
import type { TaskActivitySummary } from "@/lib/clients/generated/core";

import {
  buildActivityStats,
  clampLandingDescription,
  LANDING_DESCRIPTION_MAX_CHARS,
  orderStripCoworkers,
  resolveFeaturedCoworker,
  resolveLandingGreetingName,
  selectedCoworkerDescription,
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

describe("selectedCoworkerDescription", () => {
  it("returns a trimmed description", () => {
    const elena = buildCoworker({
      id: "elena",
      slug: "elena",
      caption: "Strategy",
      description: "  Turns goals into work.  ",
    });
    expect(selectedCoworkerDescription(elena)).toBe("Turns goals into work.");
  });

  it("returns null when description is empty — no caption fallback", () => {
    const hannah = buildCoworker({
      id: "hannah",
      slug: "hannah",
      caption: "Research",
      description: "   ",
    });
    expect(selectedCoworkerDescription(hannah)).toBeNull();
  });
});

describe("clampLandingDescription", () => {
  it("leaves short copy untouched", () => {
    expect(clampLandingDescription("Short pitch.")).toEqual({
      isTruncated: false,
      preview: "Short pitch.",
    });
  });

  it("truncates long copy near the character budget with an ellipsis", () => {
    const long = "word ".repeat(50).trim();
    const result = clampLandingDescription(long);
    expect(result.isTruncated).toBe(true);
    expect(result.preview.endsWith("…")).toBe(true);
    expect(result.preview.length).toBeLessThanOrEqual(
      LANDING_DESCRIPTION_MAX_CHARS + 1,
    );
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
    // 1 featured + 4 others = 5 → index 2
    const four = others.slice(0, 4);
    const ordered = orderStripCoworkers([featured, ...four], featured);
    expect(ordered.map((c) => c.id)).toEqual(["a", "b", "elena", "c", "d"]);
    expect(ordered).toHaveLength(5);
  });

  it("places the featured coworker left-of-centre for an even count", () => {
    // 1 featured + 3 others = 4 → index 1 (left of the two centre slots)
    const three = others.slice(0, 3);
    const ordered = orderStripCoworkers([featured, ...three], featured);
    expect(ordered.map((c) => c.id)).toEqual(["a", "elena", "b", "c"]);
    expect(ordered).toHaveLength(4);
  });

  it("keeps every coworker — never drops for even flanks", () => {
    const ordered = orderStripCoworkers([featured, ...others], featured);
    expect(ordered).toHaveLength(1 + others.length);
    expect(ordered.map((c) => c.id).sort()).toEqual(
      ["elena", ...others.map((c) => c.id)].sort(),
    );
    // 8 items → index floor(7/2)=3
    expect(ordered[3]?.id).toBe("elena");
  });

  it("returns an empty list when nothing is featured", () => {
    expect(orderStripCoworkers(others, null)).toEqual([]);
  });

  it("returns a lone featured coworker alone", () => {
    expect(orderStripCoworkers([featured], featured).map((c) => c.id)).toEqual([
      "elena",
    ]);
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
