import type {
  HermesOrganizationOption,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

export const CONFIRMATION_PERSONAL_SCOPE_VALUE = "__personal__";

const ORG_AWARE_CONFIRMATION_TOOLS = new Set([
  "sokosumi_create_task",
  "sokosumi_create_job",
]);

export function isConfirmationOrgAwareTool(toolName: string): boolean {
  return ORG_AWARE_CONFIRMATION_TOOLS.has(toolName);
}

/**
 * Options for the confirmation org `Select`. Merges membership orgs with
 * any `referencedOrganizations` missing from the client list so a
 * Hermes-pinned value always has a matching `SelectItem`.
 */
export function mergeConfirmationOrgPickerOptions(
  organizations: ReadonlyArray<HermesOrganizationOption>,
  confirmation: Pick<HermesPendingConfirmation, "referencedOrganizations">,
): HermesOrganizationOption[] {
  const byId = new Map(organizations.map((org) => [org.id, org]));
  const merged = [...organizations];
  for (const referenced of confirmation.referencedOrganizations) {
    if (byId.has(referenced.id)) continue;
    byId.set(referenced.id, referenced);
    merged.push(referenced);
  }
  return merged;
}

/**
 * Initial org dropdown value for org-aware confirmations. Always default to
 * personal scope; users must actively choose an org to approve into one.
 */
export function resolveConfirmationOrgPickerValue(
  _confirmation: Pick<HermesPendingConfirmation, "referencedOrganizations">,
  _organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
  _activeOrganizationId: string | null,
): string {
  return CONFIRMATION_PERSONAL_SCOPE_VALUE;
}

/**
 * Organization override to include in the approve request. Personal scope
 * must explicitly null `organizationId` so stale queued org args cannot
 * survive on the orchestrator path.
 */
export function buildConfirmationApproveOrganizationOverride(
  selectedOrgValue: string,
  _organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
): { organizationId: string | null } {
  if (selectedOrgValue === CONFIRMATION_PERSONAL_SCOPE_VALUE) {
    return { organizationId: null };
  }
  return { organizationId: selectedOrgValue };
}

export function buildCurrentConfirmationApproveOrganizationOverride(
  selectedOrgValueRef: { current: string },
  organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
): { organizationId: string | null } {
  return buildConfirmationApproveOrganizationOverride(
    selectedOrgValueRef.current,
    organizations,
  );
}
