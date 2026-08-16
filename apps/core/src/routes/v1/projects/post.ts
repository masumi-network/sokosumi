import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrchestratorContextHeaderParameters,
} from "@/lib/hono";
import { uploadProjectBriefingFile } from "@/lib/project-files-blob";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createProjectRequestSchema,
  mapProjectForApi,
  projectSchema,
} from "@/schemas/project.schema";

const route = withOrchestratorContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a project, optional website, logo, DESIGN.md, and briefing in the active workspace. Session user or orchestrator with context headers; coworker keys are rejected.",
    tags: ["Projects"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createProjectRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(projectSchema, "Project created"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    let project = await prisma.project.create({
      data: {
        workspaceId: workspaceContext.workspaceId,
        name: body.name,
        briefing: body.briefing ?? null,
        websiteUrl: body.websiteUrl ?? null,
        logo: body.logo ?? null,
        designMdUrl: body.designMd?.url ?? null,
        designMdExtractionId: body.designMd?.extractionId ?? null,
      },
    });

    if (body.briefing !== null && body.briefing !== undefined) {
      const briefingUrl = await uploadProjectBriefingFile(
        project.id,
        body.briefing,
      );
      if (briefingUrl) {
        project = await prisma.project.update({
          where: { id: project.id },
          data: { briefingUrl },
        });
      }
    }

    return created(c, mapProjectForApi(project));
  });
}
