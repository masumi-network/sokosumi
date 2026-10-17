import { describe, expect, it } from "vitest";

import {
  ambiguousDirectChatTargetMessage,
  directChatMemberWhere,
  directChatNeedle,
} from "./direct-chat-target";

describe("direct chat target", () => {
  it("strips a handle's @ and surrounding space", () => {
    expect(directChatNeedle("  @@ben ")).toBe("ben");
    expect(directChatNeedle("@")).toBe("");
  });

  it("matches an address only against addresses", () => {
    expect(directChatMemberWhere("org_1", "nina@x.io")).toEqual({
      organizationId: "org_1",
      user: { email: { equals: "nina@x.io", mode: "insensitive" } },
    });
  });

  it("matches a name exactly or as a first name, with wildcards escaped", () => {
    expect(directChatMemberWhere("org_1", "50%_off")).toEqual({
      organizationId: "org_1",
      user: {
        OR: [
          { name: { equals: "50%_off", mode: "insensitive" } },
          { name: { startsWith: "50\\%\\_off ", mode: "insensitive" } },
        ],
      },
    });
  });

  it("names the candidates, and only offers addresses when names collide", () => {
    expect(
      ambiguousDirectChatTargetMessage("nina", [
        { user: { name: "Nina A", email: "a@x.io" } },
        { user: { name: "Nina B", email: "b@x.io" } },
      ]),
    ).toBe(
      'More than one person matches "nina": Nina A, Nina B. Ask the owner which they mean.',
    );
    expect(
      ambiguousDirectChatTargetMessage("nina", [
        { user: { name: "Nina", email: "a@x.io" } },
        { user: { name: "NINA", email: "b@x.io" } },
      ]),
    ).toContain("a@x.io, b@x.io");
  });
});
