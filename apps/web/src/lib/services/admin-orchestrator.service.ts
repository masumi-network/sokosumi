import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Orchestrator } from "@/lib/clients/generated/core";
import type { PatchOrchestratorsByIdData } from "@/lib/clients/generated/core/types.gen";

export interface AdminOrchestratorItem {
  id: string;
  name: string;
  slug: string;
  caption: string | null;
  description: string | null;
  image: string | null;
}

export type AdminOrchestratorPatchBody = NonNullable<
  PatchOrchestratorsByIdData["body"]
>;

export type AdminOrchestratorImageIntent = "none" | "upload" | "remove";

export interface UpdateAdminOrchestratorDisplayInput {
  id: string;
  patchBody?: AdminOrchestratorPatchBody;
  imageIntent?: AdminOrchestratorImageIntent;
  imageFile?: File | Blob;
}

export interface UpdateAdminOrchestratorDisplayResult {
  orchestrator: AdminOrchestratorItem;
  imageError?: string;
}

function mapOrchestrator(orchestrator: Orchestrator): AdminOrchestratorItem {
  return {
    id: orchestrator.id,
    name: orchestrator.name,
    slug: orchestrator.slug,
    caption: orchestrator.caption,
    description: orchestrator.description,
    image: orchestrator.image,
  };
}

export const adminOrchestratorService = {
  async listOrchestrators(): Promise<AdminOrchestratorItem[]> {
    const result = await coreClient.listOrchestrators();
    return result.data.map(mapOrchestrator);
  },

  async getOrchestrator(id: string): Promise<AdminOrchestratorItem | null> {
    try {
      const result = await coreClient.getOrchestratorById(id);
      return mapOrchestrator(result.data);
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  async updateDisplay(
    input: UpdateAdminOrchestratorDisplayInput,
  ): Promise<UpdateAdminOrchestratorDisplayResult> {
    const imageIntent = input.imageIntent ?? "none";
    let orchestrator: AdminOrchestratorItem | null = null;

    if (input.patchBody && Object.keys(input.patchBody).length > 0) {
      const result = await coreClient.patchOrchestratorById(
        input.id,
        input.patchBody,
      );
      orchestrator = mapOrchestrator(result.data);
    }

    if (imageIntent === "none") {
      if (!orchestrator) {
        const existing = await this.getOrchestrator(input.id);
        if (!existing) {
          throw new CoreApiRequestError("Orchestrator not found", {
            status: 404,
          });
        }
        orchestrator = existing;
      }

      return { orchestrator };
    }

    try {
      if (imageIntent === "remove") {
        const result = await coreClient.deleteOrchestratorImage(input.id);
        orchestrator = mapOrchestrator(result.data);
      } else if (imageIntent === "upload") {
        if (!input.imageFile) {
          throw new Error("Image file is required for upload");
        }
        const result = await coreClient.uploadOrchestratorImage(
          input.id,
          input.imageFile,
        );
        orchestrator = mapOrchestrator(result.data);
      }
    } catch (error) {
      if (!orchestrator) {
        throw error;
      }

      return {
        orchestrator,
        imageError:
          error instanceof Error ? error.message : "Failed to update image",
      };
    }

    if (!orchestrator) {
      throw new Error("Orchestrator update did not return data");
    }

    return { orchestrator };
  },
};
