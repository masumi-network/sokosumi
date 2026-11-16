import type { CmoOverview } from "@sokosumi/core-client";
import { coreForCurrentUser } from "./core";

export async function requireCore() {
  const core = await coreForCurrentUser();
  if (!core) throw new Error("Not signed in to Sokosumi");
  return core;
}

/**
 * Request options in Cuso's workspace for the standard routes, which find an
 * organization's Project and contacts only with its slug header.
 */
export async function inCusoWorkspace(
  overview: Pick<CmoOverview, "organizationSlug">,
) {
  const core = await requireCore();
  return {
    ...core,
    headers: {
      ...core.headers,
      ...(overview.organizationSlug
        ? { "x-organization-slug": overview.organizationSlug }
        : {}),
    },
  };
}
