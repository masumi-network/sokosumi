import { createMiddleware } from "hono/factory";

import { requireNotCmoProject } from "@/services/cmo-cuso.service";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Writes that stay open on a CMO Project, after `/projects/{id}`: a person's
 * Pin and Hide, Task links, and the POSTs that only read (a newsletter
 * preview, a statistics refresh from the network).
 */
const OPEN_WRITE_PATTERNS = [
  /^\/star$/,
  /^\/hide$/,
  /^\/tasks(\/[^/]+)?$/,
  /^\/newsletter\/issues\/preview$/,
  /^\/social-connections\/[^/]+\/statistics\/refresh$/,
  /^\/social-posts\/[^/]+\/statistics\/refresh$/,
];

const PROJECT_PATH = /\/projects\/([^/]+)(\/.*)?$/;

/**
 * The Project a write under `/projects/{id}` changes, or null for a read and
 * for the writes left open on a CMO Project.
 */
export function cmoLockedProjectId(
  method: string,
  path: string,
): string | null {
  if (READ_METHODS.has(method)) return null;
  const [, projectId, rest = ""] = path.match(PROJECT_PATH) ?? [];
  if (!projectId || OPEN_WRITE_PATTERNS.some((pattern) => pattern.test(rest)))
    return null;
  return projectId;
}

/**
 * Every other write under `/projects/{id}` answers 409
 * `cmo_project_read_only` on a CMO Project (ADR 0066); CMO changes it
 * through `/v1/cmo/**`. Mounted before the routes, after authentication.
 */
export const cmoProjectLock = createMiddleware(async (c, next) => {
  const projectId = cmoLockedProjectId(c.req.method, c.req.path);
  if (projectId) await requireNotCmoProject(projectId);
  await next();
});
