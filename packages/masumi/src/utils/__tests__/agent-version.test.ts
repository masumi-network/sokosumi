import { describe, expect, it } from "vitest";

import { parseVersionedAgentIdentifier } from "../agent-version.js";

describe("parseVersionedAgentIdentifier", () => {
  it("separates the stable root from the 3-byte version", () => {
    expect(parseVersionedAgentIdentifier(`${"ab".repeat(57)}00000a`)).toEqual({
      registryIdentity: "ab".repeat(57),
      registryVersion: 10,
    });
  });

  it("rejects missing and non-hex version suffixes", () => {
    expect(parseVersionedAgentIdentifier("000001")).toBeUndefined();
    expect(
      parseVersionedAgentIdentifier(`${"ab".repeat(57)}version`),
    ).toBeUndefined();
  });
});
