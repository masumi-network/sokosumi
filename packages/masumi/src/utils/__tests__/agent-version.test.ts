import { describe, expect, it } from "vitest";

import {
  isV2RegistryIdentifier,
  parseVersionedAgentIdentifier,
} from "../agent-version.js";

const V2_POLICY_ID = "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b";

describe("parseVersionedAgentIdentifier", () => {
  it("separates the stable root from the 3-byte version", () => {
    expect(parseVersionedAgentIdentifier(`${"ab".repeat(57)}00000a`)).toEqual({
      registryIdentity: "ab".repeat(57),
      registryVersion: 10,
    });
  });

  it("canonicalizes uppercase identifiers to one stable identity", () => {
    const uppercaseIdentifier =
      `${V2_POLICY_ID}${"ab".repeat(29)}00000A`.toUpperCase();

    expect(parseVersionedAgentIdentifier(uppercaseIdentifier)).toEqual({
      registryIdentity: `${V2_POLICY_ID}${"ab".repeat(29)}`,
      registryVersion: 10,
    });
  });

  it("rejects missing and non-hex version suffixes", () => {
    expect(parseVersionedAgentIdentifier("000001")).toBeUndefined();
    expect(
      parseVersionedAgentIdentifier(`${"ab".repeat(57)}version`),
    ).toBeUndefined();
  });

  it("rejects V2 identifiers without the full stable asset root", () => {
    expect(parseVersionedAgentIdentifier(V2_POLICY_ID)).toBeUndefined();
    expect(
      parseVersionedAgentIdentifier(`${V2_POLICY_ID}000001`),
    ).toBeUndefined();
    expect(
      parseVersionedAgentIdentifier(`${V2_POLICY_ID}aa000001`),
    ).toBeUndefined();
    expect(
      parseVersionedAgentIdentifier(`${V2_POLICY_ID}${"zz".repeat(29)}000001`),
    ).toBeUndefined();
  });
});

describe("isV2RegistryIdentifier", () => {
  it("recognizes identifiers minted by the V2 registry policy", () => {
    expect(
      isV2RegistryIdentifier(`${V2_POLICY_ID}${"ab".repeat(29)}000001`),
    ).toBe(true);
  });

  it("recognizes uppercase-hex identifiers case-insensitively", () => {
    expect(
      isV2RegistryIdentifier(
        `${V2_POLICY_ID.toUpperCase()}${"AB".repeat(29)}000001`,
      ),
    ).toBe(true);
  });

  it("rejects identifiers under other policies", () => {
    expect(
      isV2RegistryIdentifier(
        `7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77${"ab".repeat(4)}`,
      ),
    ).toBe(false);
    expect(isV2RegistryIdentifier("short")).toBe(false);
  });
});
