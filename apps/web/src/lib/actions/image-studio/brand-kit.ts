"use server";

import type {
  SaveStudioBrandCopy,
  StudioBrandKit,
  StudioWebsiteCopy,
} from "@sokosumi/core-client";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { imageStudioService } from "@/lib/services/image-studio.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ProjectInput extends AuthenticatedRequest {
  projectId: string;
}

export const getStudioBrandKit = withSession<ProjectInput, StudioBrandKit>(
  ({ projectId }) => imageStudioService.getBrandKit(projectId),
);

export const getStudioWebsiteCopy = withSession<
  ProjectInput,
  StudioWebsiteCopy
>(({ projectId }) => imageStudioService.getWebsiteCopy(projectId));

export const uploadStudioProjectLogo = withSession<
  ProjectInput & { file: File },
  { logo: string }
>(({ projectId, file }) =>
  imageStudioService.uploadProjectLogo(projectId, file),
);

export const saveStudioBrandCopy = withSession<
  ProjectInput & SaveStudioBrandCopy,
  { ok: true; version: Date } | { ok: false; conflict: boolean }
>(async ({ projectId, copy, version }) => {
  try {
    const result = await imageStudioService.saveBrandCopy(projectId, {
      copy,
      version,
    });
    return { ok: true, version: result.version };
  } catch (error) {
    return {
      ok: false,
      conflict: error instanceof CoreApiRequestError && error.status === 409,
    };
  }
});
