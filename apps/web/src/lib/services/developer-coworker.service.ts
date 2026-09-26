import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
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
    try {
      const response = await coreClient.getOwnedCoworkerById(id);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  return {
    listOwnedCoworkers,
    getOwnedCoworkerById,
  };
})();
