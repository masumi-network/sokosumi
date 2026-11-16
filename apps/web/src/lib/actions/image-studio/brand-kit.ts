"use server";

import type {
  SaveStudioBrandCopy,
  SaveStudioBrandLook,
  StudioBrandKit,
  StudioBrandLookState,
  StudioLogoPosition,
  StudioWebsiteCopy,
  StudioWebsiteDraft,
} from "@sokosumi/core-client";
import { isOwnedProjectLogoUrl } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";
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

export const prepareStudioWebsiteDraft = withSession<
  ProjectInput,
  StudioWebsiteDraft
>(({ projectId }) => imageStudioService.prepareWebsiteDraft(projectId));

export const uploadStudioProjectLogo = withSession<
  ProjectInput & { file: File },
  { logo: string }
>(({ projectId, file }) =>
  imageStudioService.uploadProjectLogo(projectId, file),
);

export const findStudioWebsiteLogo = withSession<
  ProjectInput,
  { logo: string | null }
>(({ projectId }) => imageStudioService.findWebsiteLogo(projectId));

export const saveStudioWebsiteLogo = withSession<
  ProjectInput & { logo: string },
  { logo: string }
>(async ({ projectId, logo }) => {
  if (!isOwnedProjectLogoUrl(logo, projectId)) {
    throw new Error("Choose a logo belonging to this project");
  }
  await projectService.patchProject(projectId, { logo });
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { logo };
});

export const saveStudioLogoPosition = withSession<
  ProjectInput & { position: StudioLogoPosition | null },
  { logo: string | null; position: StudioLogoPosition | null }
>(async ({ projectId, position }) => {
  const project = await projectService.patchProject(projectId, {
    studioLogoPosition: position,
  });
  revalidatePath("/studio");
  const logo =
    project.logo && isOwnedProjectLogoUrl(project.logo, projectId)
      ? project.logo
      : null;
  return { logo, position: project.studioLogoPosition ?? null };
});

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

export const saveStudioBrandLook = withSession<
  ProjectInput & SaveStudioBrandLook,
  { ok: true; look: StudioBrandLookState } | { ok: false; conflict: boolean }
>(async ({ projectId, look, lookRevision }) => {
  try {
    return {
      ok: true,
      look: await imageStudioService.saveBrandLook(projectId, {
        look,
        lookRevision,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      conflict: error instanceof CoreApiRequestError && error.status === 409,
    };
  }
});
