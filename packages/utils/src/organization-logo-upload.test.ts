import { describe, expect, it } from "vitest";

import {
  isOrganizationLogoAllowedContentType,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
} from "./organization-logo-upload.js";

describe("isOrganizationLogoAllowedContentType", () => {
  it("accepts listed image types (case-insensitive)", () => {
    expect(isOrganizationLogoAllowedContentType("image/png")).toBe(true);
    expect(isOrganizationLogoAllowedContentType("IMAGE/JPEG")).toBe(true);
    expect(isOrganizationLogoAllowedContentType(" image/webp ")).toBe(true);
  });

  it("rejects non-image and unlisted types", () => {
    expect(isOrganizationLogoAllowedContentType("application/pdf")).toBe(false);
    expect(isOrganizationLogoAllowedContentType("text/plain")).toBe(false);
  });
});

describe("ORGANIZATION_LOGO_MAX_SIZE_BYTES", () => {
  it("is 2 MiB", () => {
    expect(ORGANIZATION_LOGO_MAX_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});
