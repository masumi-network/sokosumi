import { describe, expect, it } from "vitest";
import {
  coworkerHasCapability,
  filterCoworkersForComposeKind,
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
        company: null,
        companyLogo: null,
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
