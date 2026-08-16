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
import { uploadProjectBriefingFile } from "@/lib/project-files-blob";
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
      "Update a project's name, briefing, website, logo, or DESIGN.md. Changing websiteUrl does not clear logo or DESIGN.md. Session user or orchestrator with context headers; coworker keys are rejected.",
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
    if (body.briefing !== undefined) {
      updateData.briefing = body.briefing ?? null;
      if (body.briefing === null) {
        updateData.briefingUrl = null;
      }
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
    if (body.designMd !== undefined) {
      updateData.designMdUrl = body.designMd?.url ?? null;
      updateData.designMdExtractionId = body.designMd?.extractionId ?? null;
    }

    const updateResult = await prisma.project.updateMany({
      where: { id, workspaceId: workspaceContext.workspaceId },
      data: updateData,
    });

    if (updateResult.count === 0) {
      throw notFound("Project not found");
    }

    if (body.briefing !== null && body.briefing !== undefined) {
      const briefingUrl = await uploadProjectBriefingFile(id, body.briefing);
      if (briefingUrl) {
        await prisma.project.updateMany({
          where: { id, workspaceId: workspaceContext.workspaceId },
          data: { briefingUrl },
        });
      }
    }

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    return ok(c, mapProjectForApi(project));
  });
}
