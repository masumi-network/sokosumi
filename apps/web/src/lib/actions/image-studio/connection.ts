"use server";

import type {
  CreateStudioConnectionRequest,
  IssuedStudioConnection,
  StudioConnection,
} from "@sokosumi/core-client";

import { imageStudioService } from "@/lib/services/image-studio.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface ProjectInput extends AuthenticatedRequest {
  projectId: string;
}

export const getStudioConnection = withSession<ProjectInput, StudioConnection>(
  ({ projectId }) => imageStudioService.getConnection(projectId),
);

export const createStudioConnection = withSession<
  ProjectInput & CreateStudioConnectionRequest,
  IssuedStudioConnection
>(({ projectId, generationCreditLimit }) =>
  imageStudioService.createConnection(projectId, { generationCreditLimit }),
);

export const revokeStudioConnection = withSession<ProjectInput, void>(
  ({ projectId }) => imageStudioService.revokeConnection(projectId),
);
