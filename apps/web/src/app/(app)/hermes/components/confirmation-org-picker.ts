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
  confirmation: Pick<
    HermesPendingConfirmation,
    "referencedOrganizations" | "organizationId" | "organizationName"
  >,
): HermesOrganizationOption[] {
  const byId = new Map(organizations.map((org) => [org.id, org]));
  const merged = [...organizations];
  for (const referenced of confirmation.referencedOrganizations) {
    if (byId.has(referenced.id)) continue;
    byId.set(referenced.id, referenced);
    merged.push(referenced);
  }
  // Ensure the workspace Hermes proposed is selectable even when it's not in
  // the membership list or referenced orgs, so the pre-selected value always
  // has a matching `SelectItem` (labelled with the orchestrator's name).
  if (confirmation.organizationId && !byId.has(confirmation.organizationId)) {
    const proposed: HermesOrganizationOption = {
      id: confirmation.organizationId,
      name: confirmation.organizationName ?? confirmation.organizationId,
      slug: null,
    };
    byId.set(proposed.id, proposed);
    merged.push(proposed);
  }
  return merged;
}

/**
 * Initial org dropdown value for org-aware confirmations: the workspace Hermes
 * proposed in its tool call (`organizationId`), so the user sees and confirms
 * the actual target. `null` means Hermes proposed personal scope. Combined with
 * `buildConfirmationApproveOverrideIfChanged`, leaving this untouched sends no
 * override, so Hermes' proposal stands.
 */
export function resolveConfirmationOrgPickerValue(
  confirmation: Pick<HermesPendingConfirmation, "organizationId">,
  _organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
  _activeOrganizationId: string | null,
): string {
  return confirmation.organizationId ?? CONFIRMATION_PERSONAL_SCOPE_VALUE;
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

/**
 * Organization override to send on approve — but ONLY when the user actually
 * changed the workspace dropdown from its initial value. Returns `undefined`
 * when the selection is unchanged so the caller omits `overrides.organizationId`
 * entirely, letting the workspace Hermes proposed in its tool call stand.
 *
 * Sending an override on an untouched dropdown (including `organizationId: null`
 * for Personal) is an explicit workspace choice the user never made, and the
 * orchestrator applies it over Hermes' proposal — e.g. filing a task in Personal
 * instead of the org Hermes chose. So an override is sent only on a deliberate
 * change.
 */
export function buildConfirmationApproveOverrideIfChanged(
  selectedOrgValue: string,
  initialOrgValue: string,
  organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
): { organizationId: string | null } | undefined {
  if (selectedOrgValue === initialOrgValue) return undefined;
  return buildConfirmationApproveOrganizationOverride(
    selectedOrgValue,
    organizations,
  );
}
