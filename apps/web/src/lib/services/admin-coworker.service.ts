import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Coworker,
  PatchCoworkersByIdData,
} from "@/lib/clients/generated/core/types.gen";

type CoworkerPatchBody = NonNullable<PatchCoworkersByIdData["body"]>;

export interface AdminCoworkerDisplayUpdateBody {
  name: string;
  caption: string | null;
  description: string | null;
  image: string | null;
}

export const adminCoworkerService = (() => {
  async function listCoworkers(): Promise<Coworker[]> {
    const response = await coreClient.getCoworkers({ scope: "all" });
    return response.data ?? [];
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

  async function updateCoworkerDisplay(
    id: string,
    body: AdminCoworkerDisplayUpdateBody,
  ): Promise<Coworker> {
    const patchBody: CoworkerPatchBody = body;
    const response = await coreClient.patchCoworker(id, patchBody);
    return response.data;
  }

  return {
    listCoworkers,
    getCoworkerById,
    updateCoworkerDisplay,
  };
})();
