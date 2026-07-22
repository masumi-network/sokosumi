import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

function sortOwnedCoworkers(coworkers: Coworker[]): Coworker[] {
  return coworkers
    .filter((coworker) => coworker.archivedAt == null)
    .toSorted((left, right) => {
      const createdAtDiff =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }

      return left.id.localeCompare(right.id);
    });
}

export const developerCoworkerService = (() => {
  async function listOwnedCoworkers(): Promise<Coworker[]> {
    const response = await coreClient.getOwnedCoworkers();
    return sortOwnedCoworkers(response.data ?? []);
  }

  async function getOwnedCoworkerById(id: string): Promise<Coworker | null> {
    const coworkers = await listOwnedCoworkers();
    return coworkers.find((coworker) => coworker.id === id) ?? null;
  }

  return {
    listOwnedCoworkers,
    getOwnedCoworkerById,
  };
})();
