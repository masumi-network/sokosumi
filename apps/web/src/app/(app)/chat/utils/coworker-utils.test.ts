import { describe, expect, it } from "vitest";
import {
  coworkerCanChat,
  coworkerHasCapability,
  mapDbCoworkerToChatCoworker,
} from "./coworker-utils";
import type { Coworker } from "./types";

function baseCoworker(
  overrides: Partial<Coworker> & Pick<Coworker, "id" | "slug" | "name">,
): Coworker {
  const capabilities = overrides.capabilities ?? [];
  return {
    description: "",
    useCase: "",
    capabilities,
    archivedAt: null,
    isWhitelisted: true,
    canChat: capabilities.includes("chat"),
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
        priority: 7,
        image: null,
        caption: null,
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: new Date("2026-03-06T00:00:00.000Z"),
          updatedAt: new Date("2026-03-06T00:00:00.000Z"),
          name: "Serviceplan",
          slug: "serviceplan",
          logos: {
            light: null,
            dark: null,
          },
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
      priority: 7,
      description: "Ops helper",
      useCase: "",
      archivedAt: null,
      isWhitelisted: false,
      canChat: false,
      metadata: null,
    });
  });
});

describe("coworkerCanChat", () => {
  it("treats missing capabilities as not chat", () => {
    const noCapabilities = baseCoworker({
      id: "4",
      slug: "none",
      name: "None",
      capabilities: [],
    });
    expect(coworkerHasCapability(noCapabilities, "chat")).toBe(false);
  });

  it("excludes chat coworkers without an active runnable chat endpoint", () => {
    const inactiveChatCoworkers = [
      baseCoworker({
        id: "5",
        slug: "missing-url",
        name: "Missing URL",
        capabilities: ["chat"],
        canChat: false,
      }),
      baseCoworker({
        id: "6",
        slug: "blank-url",
        name: "Blank URL",
        capabilities: ["chat"],
        canChat: false,
      }),
      baseCoworker({
        id: "7",
        slug: "archived",
        name: "Archived",
        capabilities: ["chat"],
        canChat: false,
      }),
    ];

    expect(
      inactiveChatCoworkers.every((coworker) => !coworkerCanChat(coworker)),
    ).toBe(true);
    expect(
      coworkerCanChat({
        archivedAt: null,
        isWhitelisted: true,
        baseURL: null,
        capabilities: ["chat"],
      }),
    ).toBe(false);
    expect(
      coworkerCanChat({
        archivedAt: null,
        isWhitelisted: true,
        baseURL: "  ",
        capabilities: ["chat"],
      }),
    ).toBe(false);
    expect(
      coworkerCanChat({
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
        isWhitelisted: true,
        baseURL: "https://responses.example.com/v1",
        capabilities: ["chat"],
      }),
    ).toBe(false);
  });

  it("keeps early-access (non-whitelisted) runnable chat coworkers pickable", () => {
    // Core scope=available already filtered whitelist ∪ GRANTED; web must
    // not re-require isWhitelisted or pilot coworkers (e.g. Noodles) vanish.
    expect(
      coworkerCanChat({
        archivedAt: null,
        isWhitelisted: false,
        baseURL: "https://responses.example.com/v1",
        capabilities: ["chat"],
      }),
    ).toBe(true);
  });
});
