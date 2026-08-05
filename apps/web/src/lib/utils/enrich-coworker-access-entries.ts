import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import type { CoworkerAccessEntry } from "@/lib/utils/coworker-access-display";

/**
 * Resolve coworker display names for workspace-side access rows.
 * Best-effort: missing/failed lookups fall back to coworkerId.
 */
export async function enrichCoworkerAccessEntries(
  rows: CoworkerWorkspaceAccess[],
): Promise<CoworkerAccessEntry[]> {
  const uniqueIds = [...new Set(rows.map((row) => row.coworkerId))];
  const nameById = new Map<string, { name: string; slug: string | null }>();

  await Promise.all(
    uniqueIds.map(async (coworkerId) => {
      try {
        const response = await coreClient.getCoworkerById(coworkerId);
        const coworker = response.data;
        if (coworker) {
          nameById.set(coworkerId, {
            name: coworker.name,
            slug: coworker.slug ?? null,
          });
          return;
        }
      } catch {
        // Fall through to id fallback.
      }
      nameById.set(coworkerId, { name: coworkerId, slug: null });
    }),
  );

  return rows.map((access) => {
    const resolved = nameById.get(access.coworkerId);
    return {
      access,
      coworkerName: resolved?.name ?? access.coworkerId,
      coworkerSlug: resolved?.slug ?? null,
    };
  });
}
