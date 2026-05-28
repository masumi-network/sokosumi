export const PROJECTS_PAGE_LIMIT = 20;

/**
 * Query param value for GET /jobs and GET /tasks when listing resources
 * that are not assigned to any project. HTTP query strings cannot carry
 * JavaScript null, so the Core API accepts this literal string.
 */
export const UNASSIGNED_PROJECT_QUERY = "null" as const;
