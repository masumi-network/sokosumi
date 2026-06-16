import { describe, expect, it } from "vitest";

import {
  buildConfirmationApproveOrganizationOverride,
  buildConfirmationApproveOverrideIfChanged,
  buildCurrentConfirmationApproveOrganizationOverride,
  CONFIRMATION_PERSONAL_SCOPE_VALUE,
  isConfirmationOrgAwareTool,
  mergeConfirmationOrgPickerOptions,
  resolveConfirmationOrgPickerValue,
} from "@/app/hermes/components/confirmation-org-picker";

const organizations = [
  { id: "org-a", name: "Org A", slug: "org-a" },
  { id: "org-b", name: "Org B", slug: "org-b" },
];

describe("isConfirmationOrgAwareTool", () => {
  it.each([
    "sokosumi_create_task",
    "sokosumi_create_job",
  ])("shows the same organization picker path for %s", (toolName) => {
    expect(isConfirmationOrgAwareTool(toolName)).toBe(true);
  });

  it("does not show the organization picker for resource-scoped tools", () => {
    expect(isConfirmationOrgAwareTool("sokosumi_add_task_comment")).toBe(false);
  });
});

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
  it("defaults to personal scope even when one organization is referenced", () => {
    const value = resolveConfirmationOrgPickerValue(
      {
        referencedOrganizations: [
          { id: "org-b", name: "Org B", slug: "org-b" },
        ],
      },
      organizations,
      "org-a",
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });

  it("falls back to personal scope when no org is referenced", () => {
    const value = resolveConfirmationOrgPickerValue(
      { referencedOrganizations: [] },
      organizations,
      "org-a",
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });

  it("falls back to personal scope when there is no active org", () => {
    const value = resolveConfirmationOrgPickerValue(
      { referencedOrganizations: [] },
      organizations,
      null,
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });

  it("defaults to personal scope when the client organizations list is empty", () => {
    const value = resolveConfirmationOrgPickerValue(
      {
        referencedOrganizations: [
          { id: "org-b", name: "Org B", slug: "org-b" },
        ],
      },
      [],
      "org-a",
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });
});

describe("buildConfirmationApproveOrganizationOverride", () => {
  it("clears organization id for personal scope", () => {
    expect(
      buildConfirmationApproveOrganizationOverride(
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        organizations,
      ),
    ).toEqual({ organizationId: null });
  });

  it("passes through selected organization id", () => {
    expect(
      buildConfirmationApproveOrganizationOverride("org-a", organizations),
    ).toEqual({ organizationId: "org-a" });
  });

  it("reads the current ref value so fast personal approval clears stale orgs", () => {
    const selectedOrgValueRef = { current: "org-a" };
    const staleSelectedOrgValue = selectedOrgValueRef.current;

    selectedOrgValueRef.current = CONFIRMATION_PERSONAL_SCOPE_VALUE;

    expect(
      buildCurrentConfirmationApproveOrganizationOverride(
        selectedOrgValueRef,
        organizations,
      ),
    ).toEqual({ organizationId: null });
    expect(
      buildConfirmationApproveOrganizationOverride(
        staleSelectedOrgValue,
        organizations,
      ),
    ).toEqual({ organizationId: "org-a" });
  });
});

describe("buildConfirmationApproveOverrideIfChanged", () => {
  it("omits the override when the workspace dropdown is untouched (Personal default)", () => {
    // Regression: an untouched dropdown previously sent organizationId:null,
    // which the orchestrator applied as an explicit Personal override —
    // clobbering the workspace Hermes proposed. Unchanged ⇒ send nothing.
    expect(
      buildConfirmationApproveOverrideIfChanged(
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        organizations,
      ),
    ).toBeUndefined();
  });

  it("omits the override when an org default is left unchanged", () => {
    expect(
      buildConfirmationApproveOverrideIfChanged(
        "org-a",
        "org-a",
        organizations,
      ),
    ).toBeUndefined();
  });

  it("sends an org override when the user switches to an organization", () => {
    expect(
      buildConfirmationApproveOverrideIfChanged(
        "org-b",
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        organizations,
      ),
    ).toEqual({ organizationId: "org-b" });
  });

  it("sends a Personal override when the user switches away from an org", () => {
    expect(
      buildConfirmationApproveOverrideIfChanged(
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        "org-a",
        organizations,
      ),
    ).toEqual({ organizationId: null });
  });
});
