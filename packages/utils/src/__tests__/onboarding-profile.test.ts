import { describe, expect, it } from "vitest";
import {
  parseOnboardingCompanySize,
  parseOnboardingCompanyType,
  parseOnboardingRole,
  parseOnboardingWorkStyle,
} from "../onboarding-profile.js";
import {
  buildUserMetadataWithOnboardingProfile,
  getUserOnboardingProfile,
} from "../user-metadata.js";

describe("onboarding option parsers", () => {
  it("accepts values from the shared vocabulary", () => {
    expect(parseOnboardingCompanyType("agency")).toBe("agency");
    expect(parseOnboardingCompanySize("11-50")).toBe("11-50");
    expect(parseOnboardingRole("founder")).toBe("founder");
    expect(parseOnboardingWorkStyle("team")).toBe("team");
  });

  it("trims surrounding whitespace", () => {
    expect(parseOnboardingRole("  marketing  ")).toBe("marketing");
  });

  it("rejects unknown values and non-strings", () => {
    expect(parseOnboardingCompanyType("crypto")).toBeNull();
    expect(parseOnboardingCompanySize("42")).toBeNull();
    expect(parseOnboardingRole(42)).toBeNull();
    expect(parseOnboardingWorkStyle(null)).toBeNull();
    expect(parseOnboardingWorkStyle("TEAM")).toBeNull();
  });
});

describe("buildUserMetadataWithOnboardingProfile", () => {
  it("stores answers that round-trip through serialization", () => {
    const metadata = buildUserMetadataWithOnboardingProfile(null, {
      companySize: "11-50",
      companyType: "agency",
      role: "founder",
      workStyle: "team",
    });

    expect(getUserOnboardingProfile(JSON.stringify(metadata))).toEqual({
      companySize: "11-50",
      companyType: "agency",
      role: "founder",
      workStyle: "team",
    });
  });

  it("leaves omitted keys untouched so steps can write one answer at a time", () => {
    const first = buildUserMetadataWithOnboardingProfile(null, {
      companyType: "saas",
    });
    const second = buildUserMetadataWithOnboardingProfile(first, {
      role: "product",
    });

    expect(getUserOnboardingProfile(second)).toEqual({
      companySize: null,
      companyType: "saas",
      role: "product",
      workStyle: null,
    });
  });

  it("clears a field when the answer is explicitly null", () => {
    const stored = buildUserMetadataWithOnboardingProfile(null, {
      workStyle: "solo",
    });

    const cleared = buildUserMetadataWithOnboardingProfile(stored, {
      workStyle: null,
    });

    expect(cleared).toBeNull();
    expect(getUserOnboardingProfile(cleared)).toEqual({
      companySize: null,
      companyType: null,
      role: null,
      workStyle: null,
    });
  });

  it("drops values outside the vocabulary instead of storing them", () => {
    const metadata = buildUserMetadataWithOnboardingProfile(null, {
      // Values arrive from a client payload, so an unknown option must not
      // reach the stored record.
      companyType: "definitely-not-a-real-option" as never,
      role: "sales",
    });

    expect(getUserOnboardingProfile(metadata)).toEqual({
      companySize: null,
      companyType: null,
      role: "sales",
      workStyle: null,
    });
  });

  it("preserves unrelated metadata such as DESIGN.md pointers", () => {
    const metadata = buildUserMetadataWithOnboardingProfile(
      { designMdUrl: "https://example.com/DESIGN.md", url: "example.com" },
      { role: "marketing" },
    );

    expect(metadata).toEqual({
      designMdUrl: "https://example.com/DESIGN.md",
      onboardingRole: "marketing",
      url: "example.com",
    });
  });
});
