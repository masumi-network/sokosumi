const DESIGN_MD_DIR = "design-md";
const USERS_SEGMENT = "users";
const ORGANIZATIONS_SEGMENT = "organizations";
const PROJECTS_SEGMENT = "projects";
const AD_HOC_SEGMENT = "adhoc";

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

/**
 * Prefix for project-owned DESIGN.md blobs.
 * Example: `design-md/projects/{projectId}/`
 */
export function buildProjectDesignMdPrefix(projectId: string): string {
  return `${DESIGN_MD_DIR}/${PROJECTS_SEGMENT}/${projectId}/`;
}

/**
 * Content-hash pathname for a project DESIGN.md put (no random suffix).
 * Example: `design-md/projects/{projectId}/{extractionId-}{sha256}.md`
 */
export function buildProjectDesignMdPathname(
  projectId: string,
  fileName: string,
): string {
  return `${buildProjectDesignMdPrefix(projectId)}${fileName}`;
}

/**
 * Prefix for ad hoc, task-scoped DESIGN.md blobs — generated for one task's
 * use and never attached to the requesting user's or an organization's
 * profile. Namespaced by the requesting user so blobs stay attributable, but
 * this is not the user's own DESIGN.md.
 * Example: `design-md/adhoc/{userId}/`
 */
export function buildAdHocDesignMdPrefix(userId: string): string {
  return `${DESIGN_MD_DIR}/${AD_HOC_SEGMENT}/${userId}/`;
}

/**
 * Content-hash pathname for an ad hoc DESIGN.md store (no random suffix).
 * `fileName` is already a safe hash (optional extractionId prefix + sha256 + `.md`).
 * Example: `design-md/adhoc/{userId}/{extractionId-}{sha256}.md`
 */
export function buildAdHocDesignMdPathname(
  userId: string,
  fileName: string,
): string {
  return `${buildAdHocDesignMdPrefix(userId)}${fileName}`;
}
