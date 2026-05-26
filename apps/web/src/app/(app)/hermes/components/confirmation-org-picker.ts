import type {
  HermesOrganizationOption,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

export const CONFIRMATION_PERSONAL_SCOPE_VALUE = "__personal__";

/**
 * Org Hermes pinned in the summary (exactly one referenced org).
 * Core resolves `referencedOrganizations` with a membership check, so a
 * single entry is authoritative even when the client's `organizations`
 * list is empty or stale.
 */
function getHermesPinnedOrgValue(
  confirmation: Pick<HermesPendingConfirmation, "referencedOrganizations">,
): string | null {
  const referenced = confirmation.referencedOrganizations;
  if (referenced.length === 1) {
    return referenced[0].id;
  }
  return null;
}

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
  const pinnedOrgValue = getHermesPinnedOrgValue(confirmation);
  if (pinnedOrgValue) return pinnedOrgValue;
  const memberOrgIds = new Set(organizations.map((o) => o.id));
  if (activeOrganizationId && memberOrgIds.has(activeOrganizationId)) {
    return activeOrganizationId;
  }
  return CONFIRMATION_PERSONAL_SCOPE_VALUE;
}

/**
 * Send `overrides.organizationId` when the picker choice should drive the
 * tool call. Omit only when Hermes pinned one org and the user left that
 * selection unchanged — otherwise the UI default (active org / personal) must
 * be forwarded even if the user did not touch the dropdown.
 */
export function shouldSendOrganizationOverride(
  showOrgPicker: boolean,
  selectedOrgValue: string,
  initialOrgValue: string,
  confirmation: Pick<HermesPendingConfirmation, "referencedOrganizations">,
): boolean {
  if (!showOrgPicker) return false;
  if (selectedOrgValue !== initialOrgValue) return true;
  return getHermesPinnedOrgValue(confirmation) === null;
}

export function selectedOrgValueToOrganizationId(
  selectedOrgValue: string,
): string | null {
  return selectedOrgValue === CONFIRMATION_PERSONAL_SCOPE_VALUE
    ? null
    : selectedOrgValue;
}
