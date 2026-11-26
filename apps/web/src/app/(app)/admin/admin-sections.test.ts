import { describe, expect, it } from "vitest";

import { ADMIN_SECTIONS, getVisibleAdminSections } from "./admin-sections";

describe("getVisibleAdminSections", () => {
  it("shows the ad evals link to allowed admins", () => {
    expect(getVisibleAdminSections(true)).toEqual(ADMIN_SECTIONS);
    expect(getVisibleAdminSections(true)).toContainEqual(
      expect.objectContaining({ key: "seoAlerts", href: "/admin/seo-alerts" }),
    );
    expect(getVisibleAdminSections(true)).toContainEqual(
      expect.objectContaining({ key: "adEvals", href: "/admin/ad-evals" }),
    );
  });

  it("hides only the ad evals link when access is denied", () => {
    const sections = getVisibleAdminSections(false);

    expect(sections).toHaveLength(ADMIN_SECTIONS.length - 1);
    expect(sections).not.toContainEqual(
      expect.objectContaining({ key: "adEvals" }),
    );
    expect(sections).toContainEqual(
      expect.objectContaining({ key: "users", href: "/admin/users" }),
    );
    expect(sections).toContainEqual(
      expect.objectContaining({ key: "evals", href: "/admin/evals" }),
    );
  });
});
