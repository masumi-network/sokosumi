import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { isOwnedProjectLogoUrl } from "@sokosumi/utils";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import {
  deleteProjectBriefingBlob,
  ensureProjectFilesToken,
  uploadProjectBriefingFile,
} from "@/lib/project-files-blob";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  mapProjectForApi,
  patchProjectRequestSchema,
  projectSchema,
} from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Update a project's name, briefing, website, or logo. The deprecated description field is accepted as a briefing alias; DESIGN.md uses its dedicated PUT/DELETE routes. Changing websiteUrl does not clear logo or DESIGN.md. Session user or orchestrator with context headers; coworker keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: patchProjectRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Updated project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updateData: Prisma.ProjectUpdateManyMutationInput = {};
    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.websiteUrl !== undefined) {
      updateData.websiteUrl = body.websiteUrl ?? null;
    }
    if (body.logo !== undefined) {
      if (body.logo !== null && !isOwnedProjectLogoUrl(body.logo, id)) {
        throw unprocessableEntity(
          "Logo must be owned by this project's logo prefix",
        );
      }
      updateData.logo = body.logo ?? null;
    }
    const existingProject = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
    });
    if (!existingProject) {
      throw notFound("Project not found");
    }

    let briefingUrlToDelete: string | null = null;
    if (body.briefing !== undefined) {
      const briefing = body.briefing?.trim() || null;
      updateData.briefing = briefing;

      if (!briefing) {
        updateData.briefingUrl = null;
        briefingUrlToDelete = existingProject.briefingUrl;
      } else {
        const filesToken = await ensureProjectFilesToken(
          id,
          existingProject.filesToken,
        );
        if (!filesToken) {
          throw notFound("Project not found");
        }

        const briefingUrl = await uploadProjectBriefingFile(
          id,
          filesToken,
          briefing,
        );
        updateData.briefingUrl = briefingUrl;
        if (!briefingUrl) {
          console.warn("Project briefing saved without a Blob URL", {
            projectId: id,
          });
        }
        if (existingProject.briefingUrl !== briefingUrl) {
          briefingUrlToDelete = existingProject.briefingUrl;
        }
      }
    }

    const updateResult = await prisma.project.updateMany({
      where: { id, workspaceId: workspaceContext.workspaceId },
      data: updateData,
    });

    if (updateResult.count === 0) {
      throw notFound("Project not found");
    }

    await deleteProjectBriefingBlob(briefingUrlToDelete);

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, mapProjectForApi(project));
  });
}
