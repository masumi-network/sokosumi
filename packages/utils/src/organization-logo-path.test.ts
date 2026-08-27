import { describe, expect, it } from "vitest";

import {
  buildOrganizationLogoContentHashPathname,
  buildOrganizationLogoPathname,
  buildOrganizationLogoPrefix,
  isOwnedOrganizationLogoUrl,
} from "./organization-logo-path.js";

const ORG_ID = "01960001-0001-7001-8001-000000000099";

describe("buildOrganizationLogoPrefix", () => {
  it("returns organizations/{orgId}/logos/", () => {
    expect(buildOrganizationLogoPrefix(ORG_ID)).toBe(
      `organizations/${ORG_ID}/logos/`,
    );
  });
});

describe("buildOrganizationLogoPathname", () => {
  it("builds a sanitized pathname under the org logos prefix", () => {
    expect(buildOrganizationLogoPathname(ORG_ID, " Ops Logo (1).png ")).toBe(
      `organizations/${ORG_ID}/logos/Ops_Logo_1.png`,
    );
  });

  it("falls back when the filename is empty after sanitizing", () => {
    expect(buildOrganizationLogoPathname(ORG_ID, "@@@")).toBe(
      `organizations/${ORG_ID}/logos/file`,
    );
  });
});

describe("buildOrganizationLogoContentHashPathname", () => {
  it("appends the sha256 hex under the org logos prefix", () => {
    const hash =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(buildOrganizationLogoContentHashPathname(ORG_ID, hash)).toBe(
      `organizations/${ORG_ID}/logos/${hash}`,
    );
  });
});

describe("isOwnedOrganizationLogoUrl", () => {
  it("accepts https Vercel blob URLs under the org logos prefix", () => {
    expect(
      isOwnedOrganizationLogoUrl(
        `https://abc.public.blob.vercel-storage.com/organizations/${ORG_ID}/logos/logo-xyz.png`,
        ORG_ID,
      ),
    ).toBe(true);
  });

  it("rejects foreign hosts, wrong prefix, flat legacy path, and non-https URLs", () => {
    expect(
      isOwnedOrganizationLogoUrl(
        `https://evil.example.com/organizations/${ORG_ID}/logos/logo.png`,
        ORG_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedOrganizationLogoUrl(
        `https://abc.public.blob.vercel-storage.com/users/${ORG_ID}/logos/logo.png`,
        ORG_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedOrganizationLogoUrl(
        `https://abc.public.blob.vercel-storage.com/organizations/${ORG_ID}/logo.png`,
        ORG_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedOrganizationLogoUrl(
        "https://abc.public.blob.vercel-storage.com/organization-logos/abcdef",
        ORG_ID,
      ),
    ).toBe(false);
    expect(
      isOwnedOrganizationLogoUrl(
        `http://abc.public.blob.vercel-storage.com/organizations/${ORG_ID}/logos/logo.png`,
        ORG_ID,
      ),
    ).toBe(false);
    expect(isOwnedOrganizationLogoUrl("not-a-url", ORG_ID)).toBe(false);
  });
});
