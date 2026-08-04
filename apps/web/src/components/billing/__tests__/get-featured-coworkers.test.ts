import { describe, expect, it, vi } from "vitest";
import type { Coworker } from "@/lib/clients/generated/core";

const listCoworkersMock = vi.fn();

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

import { getFeaturedCoworkers } from "../get-featured-coworkers";

function createCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: `id-${overrides.slug ?? "coworker"}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "coworker",
    name: "Coworker",
    vendor: {
      id: "vendor-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "Vendor",
      slug: "vendor",
      logos: { light: null, dark: null },
    },
    baseURL: null,
    capabilities: ["tasks"],
    ...overrides,
  };
}

describe("getFeaturedCoworkers", () => {
  it("filters to elena, hannah, and alex in that order", async () => {
    listCoworkersMock.mockResolvedValue([
      createCoworker({ slug: "hannah", name: "Hannah" }),
      createCoworker({ slug: "someone-else", name: "Someone Else" }),
      createCoworker({ slug: "alex", name: "Alex" }),
      createCoworker({ slug: "elena", name: "Elena" }),
    ]);

    const result = await getFeaturedCoworkers();

    expect(result.map((c) => c.slug)).toEqual(["elena", "hannah", "alex"]);
    expect(listCoworkersMock).toHaveBeenCalledWith("tasks");
  });

  it("returns only the featured coworkers that exist", async () => {
    listCoworkersMock.mockResolvedValue([
      createCoworker({ slug: "elena", name: "Elena" }),
    ]);

    const result = await getFeaturedCoworkers();

    expect(result.map((c) => c.slug)).toEqual(["elena"]);
  });

  it("returns an empty array when none of the featured coworkers exist", async () => {
    listCoworkersMock.mockResolvedValue([
      createCoworker({ slug: "someone-else", name: "Someone Else" }),
    ]);

    const result = await getFeaturedCoworkers();

    expect(result).toEqual([]);
  });

  it("returns an empty array when the service throws", async () => {
    listCoworkersMock.mockRejectedValue(new Error("boom"));

    const result = await getFeaturedCoworkers();

    expect(result).toEqual([]);
  });
});
