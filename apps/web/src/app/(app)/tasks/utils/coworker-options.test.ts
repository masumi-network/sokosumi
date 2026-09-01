import { describe, expect, it } from "vitest";

import type { Coworker } from "@/lib/clients/generated/core";

import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
  groupCoworkerAssigneeOptions,
} from "./coworker-options";

function baseCoworker(overrides: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "ops-agent",
    name: "Ops Agent",
    baseURL: null,
    vendor: {
      id: "01960001-0001-7001-8001-000000000001",
      createdAt: new Date(),
      updatedAt: new Date(),
      name: "Serviceplan",
      slug: "serviceplan",
      logos: {
        light: null,
        dark: null,
      },
    },
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
    expect(options[0]).toMatchObject({
      id: "id-1",
      slug: "alex",
      name: "Alex",
      image: "https://example.com/a.png",
      description: "Helps with ops",
    });
  });

  it("omits description when absent", () => {
    const options = getCoworkerOptions([baseCoworker({ description: null })]);
    expect(options[0]).toMatchObject({
      id: "cow_1",
      slug: "ops-agent",
      name: "Ops Agent",
      image: "",
    });
    expect(options[0]?.description).toBeUndefined();
  });

  it("maps personal assistant owner fields", () => {
    const options = getCoworkerOptions([
      baseCoworker({
        id: "cow_jarvis",
        slug: "jarvis",
        name: "Jarvis",
        sokoBotId: "01960001-0001-7001-8001-000000000099",
        ownerUserId: "user_ada",
      }),
    ]);
    expect(options[0]).toMatchObject({
      id: "cow_jarvis",
      sokoBotId: "01960001-0001-7001-8001-000000000099",
      ownerUserId: "user_ada",
    });
  });
});

describe("findCoworkerIdBySlug", () => {
  it("returns id for case-insensitive slug match", () => {
    const options = getCoworkerOptions([
      baseCoworker({ id: "a", slug: "alpha", name: "Alpha" }),
      baseCoworker({ id: "b", slug: "beta", name: "Beta" }),
    ]);
    expect(findCoworkerIdBySlug(options, "BETA")).toBe("b");
    expect(findCoworkerIdBySlug(options, "alpha")).toBe("a");
  });

  it("returns null when slug is missing or unknown", () => {
    const options = getCoworkerOptions([baseCoworker()]);
    expect(findCoworkerIdBySlug(options, "nope")).toBeNull();
    expect(findCoworkerIdBySlug(options, "   ")).toBeNull();
  });
});

describe("groupCoworkerAssigneeOptions", () => {
  it("nests personal assistants under their owner and keeps marketplace coworkers separate", () => {
    const elena = getCoworkerOptions([
      baseCoworker({ id: "cow_elena", slug: "elena", name: "Elena" }),
    ])[0]!;
    const jarvis = getCoworkerOptions([
      baseCoworker({
        id: "cow_jarvis",
        slug: "jarvis",
        name: "Jarvis",
        sokoBotId: "01960001-0001-7001-8001-000000000099",
        ownerUserId: "user_ada",
      }),
    ])[0]!;
    const orphan = getCoworkerOptions([
      baseCoworker({
        id: "cow_alfred",
        slug: "alfred",
        name: "Alfred",
        sokoBotId: "01960001-0001-7001-8001-000000000098",
        ownerUserId: "user_gone",
      }),
    ])[0]!;

    const grouped = groupCoworkerAssigneeOptions(
      [elena, jarvis, orphan],
      ["user_ada", "user_grace"],
    );

    expect(grouped.marketplace.map((option) => option.id)).toEqual([
      "cow_elena",
    ]);
    expect(
      grouped.nestedByOwnerId.get("user_ada")?.map((option) => option.id),
    ).toEqual(["cow_jarvis"]);
    expect(
      grouped.unownedPersonalAssistants.map((option) => option.id),
    ).toEqual(["cow_alfred"]);
  });
});
