import { describe, expect, it } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";

import { getCoworkerOptions } from "../coworker-options";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    capabilities: ["tasks"],
    metadata: null,
    ...overrides,
  };
}

describe("getCoworkerOptions", () => {
  it("maps id, name, image, and description", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        id: "id-1",
        name: "Alex",
        slug: "alex",
        image: "https://example.com/a.png",
        description: "Helps with ops",
      }),
    ]);
    expect(options[0]).toEqual({
      id: "id-1",
      name: "Alex",
      image: "https://example.com/a.png",
      description: "Helps with ops",
    });
  });

  it("omits description when absent", () => {
    const options = getCoworkerOptions([baseCoworker({ description: null })]);
    expect(options[0]).toEqual({
      id: "cow_1",
      name: "Ops Agent",
      image: "",
    });
    expect(options[0]?.description).toBeUndefined();
  });
});
