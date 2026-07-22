import { describe, expect, it } from "vitest";

import { mockCoreCoworker } from "@/test-fixtures/coworker";

import { buildCoworkerDisplayPatchBody } from "../coworker-display-utils";

const coworker = mockCoreCoworker({
  caption: "Caption",
  description: "Description",
});

describe("buildCoworkerDisplayPatchBody", () => {
  it("returns undefined when values are unchanged", () => {
    const result = buildCoworkerDisplayPatchBody(coworker, {
      name: "Ops Agent",
      caption: "Caption",
      description: "Description",
    });

    expect(result).toBeUndefined();
  });

  it("trims optional text to null", () => {
    const result = buildCoworkerDisplayPatchBody(coworker, {
      name: "Ops Agent",
      caption: "   ",
      description: "  ",
    });

    expect(result).toEqual({
      caption: null,
      description: null,
    });
  });
});
