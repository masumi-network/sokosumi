import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import type { AdminCoworkerCapability } from "@/lib/constants/coworker-display";
import {
  type CoworkerDisplayPatchBody,
  type CoworkerImageIntent,
  coworkerDisplayService,
  type UpdateCoworkerDisplayInput,
  type UpdateCoworkerDisplayResult,
} from "@/lib/services/coworker-display.service";

export type {
  CoworkerDisplayPatchBody as AdminCoworkerDisplayPatchBody,
  CoworkerImageIntent as AdminCoworkerImageIntent,
  UpdateCoworkerDisplayInput as UpdateAdminCoworkerDisplayInput,
  UpdateCoworkerDisplayResult as UpdateAdminCoworkerDisplayResult,
};

export interface AdminCoworkerControlsPatchBody {
  capabilities?: AdminCoworkerCapability[];
  priority?: number;
}

function sortCoworkers(coworkers: Coworker[]): Coworker[] {
  return coworkers.toSorted((left, right) => {
    const createdAtDiff = right.createdAt.getTime() - left.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

function mergeCoworkerLists(
  active: Coworker[],
  archived: Coworker[],
): Coworker[] {
  const byId = new Map<string, Coworker>();
  for (const coworker of [...active, ...archived]) {
    byId.set(coworker.id, coworker);
  }
  return sortCoworkers([...byId.values()]);
}

export const adminCoworkerService = (() => {
  async function listCoworkers(): Promise<Coworker[]> {
    const [activeResponse, archivedResponse] = await Promise.all([
      coreClient.getCoworkers({ scope: "all" }),
      coreClient.getCoworkers({ scope: "archived" }),
    ]);

    return mergeCoworkerLists(
      activeResponse.data ?? [],
      archivedResponse.data ?? [],
    );
  }

  async function getCoworkerById(id: string): Promise<Coworker | null> {
    try {
      const response = await coreClient.getCoworkerById(id);
      return response.data;
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async function updateDisplay(
    input: UpdateCoworkerDisplayInput,
  ): Promise<UpdateCoworkerDisplayResult> {
    return coworkerDisplayService.updateDisplay(input);
  }

  async function updateControls(
    id: string,
    patchBody: AdminCoworkerControlsPatchBody,
  ): Promise<Coworker> {
    const result = await coreClient.patchCoworker(id, patchBody);
    if (!result.data) {
      throw new Error("Coworker update did not return data");
    }
    return result.data;
  }

  async function updateWhitelist(
    id: string,
    isWhitelisted: boolean,
  ): Promise<Coworker> {
    const result = await coreClient.patchCoworkerWhitelist(id, {
      isWhitelisted,
    });
    if (!result.data) {
      throw new Error("Coworker whitelist update did not return data");
    }
    return result.data;
  }

  async function archiveCoworker(id: string): Promise<Coworker> {
    const result = await coreClient.archiveCoworker(id);
    if (!result.data) {
      throw new Error("Coworker archive did not return data");
    }
    return result.data;
  }

  async function unarchiveCoworker(id: string): Promise<Coworker> {
    const result = await coreClient.unarchiveCoworker(id);
    if (!result.data) {
      throw new Error("Coworker unarchive did not return data");
    }
    return result.data;
  }

  return {
    listCoworkers,
    getCoworkerById,
    updateDisplay,
    updateControls,
    updateWhitelist,
    archiveCoworker,
    unarchiveCoworker,
  };
})();
