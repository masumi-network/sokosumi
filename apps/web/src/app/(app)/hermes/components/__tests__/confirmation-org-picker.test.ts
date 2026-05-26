import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_PERSONAL_SCOPE_VALUE,
  resolveConfirmationOrgPickerValue,
  selectedOrgValueToOrganizationId,
  shouldSendOrganizationOverride,
} from "@/app/hermes/components/confirmation-org-picker";

const organizations = [
  { id: "org-a", name: "Org A" },
  { id: "org-b", name: "Org B" },
];

describe("resolveConfirmationOrgPickerValue", () => {
  it("prefers a single referenced organization over the active org", () => {
    const value = resolveConfirmationOrgPickerValue(
      {
        referencedOrganizations: [
          { id: "org-b", name: "Org B", slug: "org-b" },
        ],
      },
      organizations,
      "org-a",
    );
    expect(value).toBe("org-b");
  });

  it("falls back to the active org when no org is referenced", () => {
    const value = resolveConfirmationOrgPickerValue(
      { referencedOrganizations: [] },
      organizations,
      "org-a",
    );
    expect(value).toBe("org-a");
  });

  it("falls back to personal scope when there is no active org", () => {
    const value = resolveConfirmationOrgPickerValue(
      { referencedOrganizations: [] },
      organizations,
      null,
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });
});

describe("shouldSendOrganizationOverride", () => {
  const pinnedConfirmation = {
    referencedOrganizations: [{ id: "org-b", name: "Org B", slug: "org-b" }],
  };
  const unpinnedConfirmation = { referencedOrganizations: [] };

  it("omits overrides when Hermes pinned one org and the user leaves it", () => {
    expect(
      shouldSendOrganizationOverride(
        true,
        "org-b",
        "org-b",
        pinnedConfirmation,
        organizations,
      ),
    ).toBe(false);
  });

  it("sends overrides for the active-org default when no org is pinned", () => {
    expect(
      shouldSendOrganizationOverride(
        true,
        "org-a",
        "org-a",
        unpinnedConfirmation,
        organizations,
      ),
    ).toBe(true);
  });

  it("sends overrides when the user changes the dropdown", () => {
    expect(
      shouldSendOrganizationOverride(
        true,
        "org-a",
        "org-b",
        pinnedConfirmation,
        organizations,
      ),
    ).toBe(true);
  });

  it("never sends overrides for tools without an org picker", () => {
    expect(
      shouldSendOrganizationOverride(
        false,
        "org-a",
        "org-b",
        unpinnedConfirmation,
        organizations,
      ),
    ).toBe(false);
  });
});

describe("selectedOrgValueToOrganizationId", () => {
  it("maps personal scope to null", () => {
    expect(
      selectedOrgValueToOrganizationId(CONFIRMATION_PERSONAL_SCOPE_VALUE),
    ).toBeNull();
  });

  it("passes through organization ids", () => {
    expect(selectedOrgValueToOrganizationId("org-a")).toBe("org-a");
  });
});
