import { getWebAppBaseUrl } from "@/config/env";

/**
 * Absolute web-app URL. Strips trailing slashes from the base so
 * `{webBase}/{path}` cannot pick up a double slash from env.
 *
 * `path` is a pathname that starts with `/`.
 */
export function buildWebAppUrl(path: string): string {
  return `${getWebAppBaseUrl().replace(/\/+$/, "")}${path}`;
}
