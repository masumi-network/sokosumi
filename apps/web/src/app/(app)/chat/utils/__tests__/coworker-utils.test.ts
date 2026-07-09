import { describe, expect, it } from "vitest";
import {
  coworkerHasCapability,
  filterCoworkersForComposeKind,
  findCoworkerBySlugOrId,
  findDefaultCoworker,
  mapDbCoworkerToChatCoworker,
} from "../coworker-utils";
import type { Coworker } from "../types";

function baseCoworker(
  overrides: Partial<Coworker> & Pick<Coworker, "id" | "slug" | "name">,
): Coworker {
  return {
    description: "",
    useCase: "",
    capabilities: [],
    ...overrides,
  };
}

describe("mapDbCoworkerToChatCoworker", () => {
  it("keeps the coworker slug on the chat shape", () => {
    expect(
      mapDbCoworkerToChatCoworker({
        id: "cow_123",
        slug: "elena",
        name: "Elena",
        description: "Ops helper",
        archivedAt: null,
        isWhitelisted: false,
        priority: 0,
        image: null,
        caption: null,
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: new Date("2026-03-06T00:00:00.000Z"),
          updatedAt: new Date("2026-03-06T00:00:00.000Z"),
          name: "Service Plan",
          slug: "service-plan",
          logo: null,
        },
        url: null,
        baseURL: null,
        capabilities: [],
        metadata: null,
        createdAt: new Date("2026-03-06T00:00:00.000Z"),
        updatedAt: new Date("2026-03-06T00:00:00.000Z"),
      }),
    ).toMatchObject({
      id: "cow_123",
      slug: "elena",
      name: "Elena",
      description: "Ops helper",
      useCase: "",
      metadata: null,
    });
  });
});

describe("findCoworkerBySlugOrId", () => {
  const coworkers = [
    baseCoworker({ id: "id-1", slug: "elena", name: "Elena" }),
    baseCoworker({ id: "tasky", slug: "tasky", name: "Tasky" }),
  ];

  it("matches slug case-insensitively", () => {
    expect(findCoworkerBySlugOrId(coworkers, "ELENA")).toEqual(coworkers[0]);
  });

  it("falls back to id when slug does not match", () => {
    expect(findCoworkerBySlugOrId(coworkers, "tasky")).toEqual(coworkers[1]);
  });
});

describe("findDefaultCoworker", () => {
  it("prefers elena when present in the list", () => {
    const coworkers = [
      baseCoworker({ id: "1", slug: "tasky", name: "Tasky" }),
      baseCoworker({ id: "2", slug: "elena", name: "Elena" }),
    ];
    expect(findDefaultCoworker(coworkers)).toEqual(coworkers[1]);
  });

  it("falls back to first list entry when elena is absent", () => {
    const coworkers = [
      baseCoworker({ id: "1", slug: "tasky", name: "Tasky" }),
      baseCoworker({ id: "2", slug: "alex", name: "Alex" }),
    ];
    expect(findDefaultCoworker(coworkers)).toEqual(coworkers[0]);
  });
});

describe("filterCoworkersForComposeKind", () => {
  const coworkers = [
    baseCoworker({
      id: "1",
      slug: "both",
      name: "Both",
      capabilities: ["chat", "tasks"],
    }),
    baseCoworker({
      id: "2",
      slug: "chat-only",
      name: "Chat only",
      capabilities: ["chat"],
    }),
    baseCoworker({
      id: "3",
      slug: "task-only",
      name: "Task only",
      capabilities: ["tasks"],
    }),
  ];

  it("returns task-capable coworkers for task compose kind", () => {
    expect(filterCoworkersForComposeKind(coworkers, "task")).toEqual([
      coworkers[0],
      coworkers[2],
    ]);
  });

  it("returns chat-capable coworkers for chat compose kind", () => {
    expect(filterCoworkersForComposeKind(coworkers, "chat")).toEqual([
      coworkers[0],
      coworkers[1],
    ]);
  });

  it("excludes coworkers with missing or empty capabilities", () => {
    const noCapabilities = baseCoworker({
      id: "4",
      slug: "none",
      name: "None",
      capabilities: [],
    });
    expect(coworkerHasCapability(noCapabilities, "chat")).toBe(false);
    expect(filterCoworkersForComposeKind([noCapabilities], "chat")).toEqual([]);
    expect(filterCoworkersForComposeKind([noCapabilities], "task")).toEqual([]);
  });
});
