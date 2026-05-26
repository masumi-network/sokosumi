import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_PERSONAL_SCOPE_VALUE,
  mergeConfirmationOrgPickerOptions,
  resolveConfirmationOrgPickerValue,
  selectedOrgValueToOrganizationId,
  shouldSendOrganizationOverride,
} from "@/app/hermes/components/confirmation-org-picker";

const organizations = [
  { id: "org-a", name: "Org A" },
  { id: "org-b", name: "Org B" },
];

describe("mergeConfirmationOrgPickerOptions", () => {
  it("appends referenced organizations missing from the client list", () => {
    const options = mergeConfirmationOrgPickerOptions([], {
      referencedOrganizations: [{ id: "org-b", name: "Org B", slug: "org-b" }],
    });
    expect(options).toEqual([{ id: "org-b", name: "Org B", slug: "org-b" }]);
  });

  it("deduplicates when a referenced org is already in the membership list", () => {
    const options = mergeConfirmationOrgPickerOptions(organizations, {
      referencedOrganizations: [
        { id: "org-a", name: "Referenced A", slug: "ref-a" },
      ],
    });
    expect(options).toEqual(organizations);
  });
});

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

  it("pins to a single referenced org when the client organizations list is empty", () => {
    const value = resolveConfirmationOrgPickerValue(
      {
        referencedOrganizations: [
          { id: "org-b", name: "Org B", slug: "org-b" },
        ],
      },
      [],
      "org-a",
    );
    expect(value).toBe("org-b");
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
      ),
    ).toBe(false);
  });

  it("omits overrides when Core pinned one org even if picker still shows personal", () => {
    expect(
      shouldSendOrganizationOverride(
        true,
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        pinnedConfirmation,
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
