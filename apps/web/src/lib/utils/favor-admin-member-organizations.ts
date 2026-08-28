/**
 * Stable sort: organizations the admin belongs to first, then others.
 * Relative order within each group is preserved.
 */
export function favorAdminMemberOrganizations<T extends { id: string }>(
  organizations: T[],
  memberOrganizationIds: ReadonlySet<string>,
): T[] {
  if (memberOrganizationIds.size === 0 || organizations.length < 2) {
    return organizations;
  }

  const favored: T[] = [];
  const rest: T[] = [];
  for (const organization of organizations) {
    if (memberOrganizationIds.has(organization.id)) {
      favored.push(organization);
    } else {
      rest.push(organization);
    }
  }
  return favored.length === 0 ? organizations : [...favored, ...rest];
}
