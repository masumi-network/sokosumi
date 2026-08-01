const DESIGN_MD_DIR = "design-md";
const USERS_SEGMENT = "users";
const ORGANIZATIONS_SEGMENT = "organizations";

/**
 * Prefix for user-owned DESIGN.md blobs.
 * Example: `design-md/users/{userId}/`
 */
export function buildUserDesignMdPrefix(userId: string): string {
  return `${DESIGN_MD_DIR}/${USERS_SEGMENT}/${userId}/`;
}

/**
 * Prefix for organization-owned DESIGN.md blobs.
 * Example: `design-md/organizations/{organizationId}/`
 */
export function buildOrganizationDesignMdPrefix(
  organizationId: string,
): string {
  return `${DESIGN_MD_DIR}/${ORGANIZATIONS_SEGMENT}/${organizationId}/`;
}

/**
 * Content-hash pathname for a user DESIGN.md put (no random suffix).
 * `fileName` is already a safe hash (optional extractionId prefix + sha256 + `.md`).
 * Example: `design-md/users/{userId}/{extractionId-}{sha256}.md`
 */
export function buildUserDesignMdPathname(
  userId: string,
  fileName: string,
): string {
  return `${buildUserDesignMdPrefix(userId)}${fileName}`;
}

/**
 * Content-hash pathname for an organization DESIGN.md put (no random suffix).
 * `fileName` is already a safe hash (optional extractionId prefix + sha256 + `.md`).
 * Example: `design-md/organizations/{organizationId}/{extractionId-}{sha256}.md`
 */
export function buildOrganizationDesignMdPathname(
  organizationId: string,
  fileName: string,
): string {
  return `${buildOrganizationDesignMdPrefix(organizationId)}${fileName}`;
}
