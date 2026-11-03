import { describe, expect, it } from "vitest";

import {
  isLinkedInOrganization,
  linkedInAuthorUrn,
  linkedInOrganizationId,
} from "@/clients/social-post-providers/linkedin-author";

describe("linkedInAuthorUrn", () => {
  it.each([
    ["person_42", "urn:li:person:person_42"],
    ["urn:li:person:person_42", "urn:li:person:person_42"],
    ["urn:li:person:urn:li:person:person_42", "urn:li:person:person_42"],
    ["urn:li:organization:123", "urn:li:organization:123"],
    ["urn:li:organization:urn:li:organization:123", "urn:li:organization:123"],
  ])("normalises %s to %s", (input, expected) => {
    expect(linkedInAuthorUrn(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const value of [
      "person_42",
      "urn:li:person:urn:li:person:person_42",
      "urn:li:organization:123",
    ]) {
      const once = linkedInAuthorUrn(value);
      expect(linkedInAuthorUrn(once)).toBe(once);
    }
  });

  it("never reads a bare numeric id as an organization", () => {
    expect(linkedInAuthorUrn("123")).toBe("urn:li:person:123");
  });
});

describe("isLinkedInOrganization", () => {
  it("only matches organization URNs", () => {
    expect(isLinkedInOrganization("urn:li:organization:123")).toBe(true);
    expect(isLinkedInOrganization("urn:li:person:abc")).toBe(false);
    expect(isLinkedInOrganization("abc")).toBe(false);
    expect(isLinkedInOrganization("123")).toBe(false);
  });
});

describe("linkedInOrganizationId", () => {
  it("returns the numeric id for URNs and bare ids", () => {
    expect(linkedInOrganizationId("urn:li:organization:123")).toBe("123");
    expect(linkedInOrganizationId("123")).toBe("123");
  });
});
