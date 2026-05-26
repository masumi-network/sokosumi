import type {
  HermesOrganizationOption,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

export const CONFIRMATION_PERSONAL_SCOPE_VALUE = "__personal__";

/**
 * Initial org dropdown value for org-aware confirmations. Prefer a single
 * org referenced in the summary (Hermes' likely intent) over the session
 * active org so approving without changes can omit overrides.
 */
export function resolveConfirmationOrgPickerValue(
  confirmation: Pick<HermesPendingConfirmation, "referencedOrganizations">,
  organizations: ReadonlyArray<Pick<HermesOrganizationOption, "id">>,
  activeOrganizationId: string | null,
): string {
  const memberOrgIds = new Set(organizations.map((o) => o.id));
  const referenced = confirmation.referencedOrganizations;
  if (referenced.length === 1 && memberOrgIds.has(referenced[0].id)) {
    return referenced[0].id;
  }
  if (activeOrganizationId && memberOrgIds.has(activeOrganizationId)) {
    return activeOrganizationId;
  }
  return CONFIRMATION_PERSONAL_SCOPE_VALUE;
}

/** Send `overrides.organizationId` only when the user changed the dropdown. */
export function shouldSendOrganizationOverride(
  showOrgPicker: boolean,
  selectedOrgValue: string,
  initialOrgValue: string,
): boolean {
  return showOrgPicker && selectedOrgValue !== initialOrgValue;
}

export function selectedOrgValueToOrganizationId(
  selectedOrgValue: string,
): string | null {
  return selectedOrgValue === CONFIRMATION_PERSONAL_SCOPE_VALUE
    ? null
    : selectedOrgValue;
}
