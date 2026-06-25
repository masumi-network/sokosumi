import { describe, expect, it } from "vitest";

import {
  applyConfirmationOrgProposalUpdate,
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
      organizationId: null,
      organizationName: null,
    });
    expect(options).toEqual([{ id: "org-b", name: "Org B", slug: "org-b" }]);
  });

  it("deduplicates when a referenced org is already in the membership list", () => {
    const options = mergeConfirmationOrgPickerOptions(organizations, {
      referencedOrganizations: [
        { id: "org-a", name: "Referenced A", slug: "ref-a" },
      ],
      organizationId: null,
      organizationName: null,
    });
    expect(options).toEqual(organizations);
  });

  it("adds Hermes' proposed workspace as a selectable option when missing", () => {
    const options = mergeConfirmationOrgPickerOptions(organizations, {
      referencedOrganizations: [],
      organizationId: "org-c",
      organizationName: "Org C",
    });
    expect(options).toEqual([
      ...organizations,
      { id: "org-c", name: "Org C", slug: null },
    ]);
  });

  it("labels the proposed workspace by id when no name was provided", () => {
    const options = mergeConfirmationOrgPickerOptions([], {
      referencedOrganizations: [],
      organizationId: "org-c",
      organizationName: null,
    });
    expect(options).toEqual([{ id: "org-c", name: "org-c", slug: null }]);
  });

  it("does not duplicate the proposed workspace when already present", () => {
    const options = mergeConfirmationOrgPickerOptions(organizations, {
      referencedOrganizations: [],
      organizationId: "org-a",
      organizationName: "Org A",
    });
    expect(options).toEqual(organizations);
  });
});

describe("resolveConfirmationOrgPickerValue", () => {
  it("defaults to the workspace Hermes proposed", () => {
    const value = resolveConfirmationOrgPickerValue(
      { organizationId: "org-b" },
      organizations,
      "org-a",
    );
    expect(value).toBe("org-b");
  });

  it("defaults to personal scope when Hermes proposed personal (null)", () => {
    const value = resolveConfirmationOrgPickerValue(
      { organizationId: null },
      organizations,
      "org-a",
    );
    expect(value).toBe(CONFIRMATION_PERSONAL_SCOPE_VALUE);
  });

  it("uses the proposed workspace even when it is not in the membership list", () => {
    const value = resolveConfirmationOrgPickerValue(
      { organizationId: "org-c" },
      [],
      "org-a",
    );
    expect(value).toBe("org-c");
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

describe("applyConfirmationOrgProposalUpdate", () => {
  it("returns the same state when the proposal is unchanged", () => {
    const state = {
      baselineOrgValue: CONFIRMATION_PERSONAL_SCOPE_VALUE,
      selectedOrgValue: CONFIRMATION_PERSONAL_SCOPE_VALUE,
      userChangedOrg: false,
    };

    expect(
      applyConfirmationOrgProposalUpdate(
        CONFIRMATION_PERSONAL_SCOPE_VALUE,
        state,
      ),
    ).toBe(state);
  });

  it("follows a newly populated proposal when the user has not changed the dropdown", () => {
    const state = {
      baselineOrgValue: CONFIRMATION_PERSONAL_SCOPE_VALUE,
      selectedOrgValue: CONFIRMATION_PERSONAL_SCOPE_VALUE,
      userChangedOrg: false,
    };

    expect(applyConfirmationOrgProposalUpdate("org-a", state)).toEqual({
      baselineOrgValue: "org-a",
      selectedOrgValue: "org-a",
      userChangedOrg: false,
    });
  });

  it("keeps an explicit user selection when the proposal updates later", () => {
    const state = {
      baselineOrgValue: CONFIRMATION_PERSONAL_SCOPE_VALUE,
      selectedOrgValue: "org-b",
      userChangedOrg: true,
    };

    expect(applyConfirmationOrgProposalUpdate("org-a", state)).toEqual({
      baselineOrgValue: "org-a",
      selectedOrgValue: "org-b",
      userChangedOrg: true,
    });
  });
});
