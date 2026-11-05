import type { RecentProjectsScope } from "@/hooks/use-recent-projects";

/**
 * Reads a project switcher list from its Route Handler, and refuses rows
 * read in another workspace than the one the browser asked about: after a
 * workspace switch, an old workspace's project would still be clickable.
 */
export async function fetchScopeList<T>(
  path: string,
  expectedScope: RecentProjectsScope,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Project list read failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    scope: RecentProjectsScope;
    data: T;
  };
  if (
    body.scope.userId !== expectedScope.userId ||
    body.scope.organizationId !== expectedScope.organizationId
  ) {
    throw new Error("Project workspace changed");
  }
  return body.data;
}
