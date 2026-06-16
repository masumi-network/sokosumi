import type { MemberWithOrganization } from "@sokosumi/utils";

/**
 * Resolves an account name from an organization ID and members list.
 *
 * @param organizationId - The target organization ID (null for personal account)
 * @param members - Array of members with organization data
 * @param personalAccountLabel - Translated label for personal account fallback
 * @returns The resolved account name (org name, org ID, or personal account label)
 */
export function resolveAccountName(
  organizationId: string | null,
  members: MemberWithOrganization[],
  personalAccountLabel: string,
): string {
  if (!organizationId) {
    return personalAccountLabel;
  }

  const member = members.find(
    (member) => member.organizationId === organizationId,
  );

  return member?.organization.name ?? organizationId;
}
