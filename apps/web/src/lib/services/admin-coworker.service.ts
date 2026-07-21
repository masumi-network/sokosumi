import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

export interface AdminCoworkerDisplayPatchBody {
  name?: string;
  caption?: string | null;
  description?: string | null;
}

export type AdminCoworkerImageIntent = "none" | "upload" | "remove";

export interface UpdateAdminCoworkerDisplayInput {
  id: string;
  patchBody?: AdminCoworkerDisplayPatchBody;
  imageIntent?: AdminCoworkerImageIntent;
  imageFile?: File | Blob;
}

export interface UpdateAdminCoworkerDisplayResult {
  coworker: Coworker;
  imageError?: string;
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

  async function updateDisplay(
    input: UpdateAdminCoworkerDisplayInput,
  ): Promise<UpdateAdminCoworkerDisplayResult> {
    const imageIntent = input.imageIntent ?? "none";
    let coworker: Coworker | null = null;

    if (input.patchBody && Object.keys(input.patchBody).length > 0) {
      const result = await coreClient.patchCoworker(input.id, input.patchBody);
      coworker = result.data;
    }

    if (imageIntent === "none") {
      if (!coworker) {
        const existing = await getCoworkerById(input.id);
        if (!existing) {
          throw new CoreApiRequestError("Coworker not found", {
            status: 404,
          });
        }
        coworker = existing;
      }

      return { coworker };
    }

    try {
      if (imageIntent === "remove") {
        const result = await coreClient.deleteCoworkerImage(input.id);
        coworker = result.data;
      } else if (imageIntent === "upload") {
        if (!input.imageFile) {
          throw new Error("Image file is required for upload");
        }
        const result = await coreClient.uploadCoworkerImage(
          input.id,
          input.imageFile,
        );
        coworker = result.data;
      }
    } catch (error) {
      if (!coworker) {
        throw error;
      }

      return {
        coworker,
        imageError:
          error instanceof Error ? error.message : "Failed to update image",
      };
    }

    if (!coworker) {
      throw new Error("Coworker update did not return data");
    }

    return { coworker };
  }

  return {
    listCoworkers,
    getCoworkerById,
    updateDisplay,
  };
})();
