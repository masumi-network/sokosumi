const DESIGN_MD_DIR = "design-md";
const USERS_SEGMENT = "users";
const ORGANIZATIONS_SEGMENT = "organizations";
const PROJECTS_SEGMENT = "projects";
const AD_HOC_SEGMENT = "adhoc";

export function buildUserDesignMdPrefix(userId: string): string {
  return `${DESIGN_MD_DIR}/${USERS_SEGMENT}/${userId}/`;
}

export function buildOrganizationDesignMdPrefix(
  organizationId: string,
): string {
  return `${DESIGN_MD_DIR}/${ORGANIZATIONS_SEGMENT}/${organizationId}/`;
}

/** `fileName` is already a safe hash (optional extractionId prefix + sha256 + `.md`). */
export function buildUserDesignMdPathname(
  userId: string,
  fileName: string,
): string {
  return `${buildUserDesignMdPrefix(userId)}${fileName}`;
}

/** `fileName` is already a safe hash (optional extractionId prefix + sha256 + `.md`). */
export function buildOrganizationDesignMdPathname(
  organizationId: string,
  fileName: string,
): string {
  return `${buildOrganizationDesignMdPrefix(organizationId)}${fileName}`;
}

export function buildProjectDesignMdPrefix(projectId: string): string {
  return `${DESIGN_MD_DIR}/${PROJECTS_SEGMENT}/${projectId}/`;
}

export function buildProjectDesignMdPathname(
  projectId: string,
  fileName: string,
): string {
  return `${buildProjectDesignMdPrefix(projectId)}${fileName}`;
}

/**
 * Task-scoped DESIGN.md: never the requester's or an organization's profile
 * blob. Namespaced by the requesting user so the blob stays attributable.
 */
export function buildAdHocDesignMdPrefix(userId: string): string {
  return `${DESIGN_MD_DIR}/${AD_HOC_SEGMENT}/${userId}/`;
}

export function buildAdHocDesignMdPathname(
  userId: string,
  fileName: string,
): string {
  return `${buildAdHocDesignMdPrefix(userId)}${fileName}`;
}
