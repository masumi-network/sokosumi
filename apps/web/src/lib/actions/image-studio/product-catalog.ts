"use server";

import type {
  StudioProductCatalog,
  StudioProductImport,
  StudioProductPhoto,
} from "@sokosumi/core-client";

import { imageStudioService } from "@/lib/services/image-studio.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ProjectInput extends AuthenticatedRequest {
  projectId: string;
}

export const getStudioProducts = withSession<
  ProjectInput,
  StudioProductCatalog
>(({ projectId }) => imageStudioService.getProductCatalog(projectId));

export const saveStudioProducts = withSession<
  ProjectInput & { catalog: StudioProductCatalog },
  StudioProductCatalog
>(({ projectId, catalog }) =>
  imageStudioService.replaceProductCatalog(projectId, catalog),
);

export const importStudioProducts = withSession<
  ProjectInput & { url: string },
  StudioProductImport
>(({ projectId, url }) => imageStudioService.importProducts(projectId, url));

export const attachStudioCatalogPhoto = withSession<
  ProjectInput & { name: string; imageUrl: string },
  StudioProductPhoto
>(({ projectId, name, imageUrl }) =>
  imageStudioService.attachProductPhoto(projectId, { name, imageUrl }),
);
