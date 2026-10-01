import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS, isOwnedProjectLogoUrl } from "@sokosumi/utils";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isProjectIdentifierUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
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

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}",
    description:
      "Update a project's name, identifier, briefing, website, or logo. The deprecated description field is accepted as a briefing alias; DESIGN.md uses its dedicated PUT/DELETE routes. Changing websiteUrl does not clear logo or DESIGN.md. Identifier changes are rejected once the project has issued task numbers, so bookmarked SOK-N URLs stay resolvable. Interactive session user only; coworker keys are rejected.",
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
      409: jsonErrorResponse(
        "Project identifier already in use or immutable after task numbers",
      ),
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

    const updateData: Prisma.ProjectUpdateManyMutationInput = {
      projectRevision: { increment: 1 },
    };
    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.identifier !== undefined) {
      updateData.identifier = body.identifier;
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

    // Task refs resolve by the live project identifier. Once numbers exist,
    // renaming the prefix would 404 every bookmarked /tasks/SOK-N URL; freeze
    // instead of building a second alias table for prefixes.
    const identifierChanging =
      body.identifier !== undefined &&
      body.identifier !== existingProject.identifier;
    if (identifierChanging && existingProject.taskCounter > 0) {
      throw conflict(
        "Project identifier cannot change after task numbers have been issued",
        { kind: CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_IMMUTABLE },
      );
    }

    // Commit the rename before any briefing blob write so a duplicate-identifier
    // 409 cannot leave BRIEFING.md overwritten while Postgres keeps the old text.
    if (identifierChanging) {
      const identifierResult = await prisma.project
        .updateMany({
          where: {
            id,
            workspaceId: workspaceContext.workspaceId,
            taskCounter: 0,
          },
          data: { identifier: body.identifier },
        })
        .catch((error: unknown) => {
          throw isProjectIdentifierUniqueConstraintError(error)
            ? conflict("Project identifier already in use in this workspace", {
                kind: CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
              })
            : error;
        });

      if (identifierResult.count === 0) {
        const racedProject = await prisma.project.findFirst({
          where: { id, workspaceId: workspaceContext.workspaceId },
          select: { taskCounter: true },
        });
        if (racedProject) {
          throw conflict(
            "Project identifier cannot change after task numbers have been issued",
            { kind: CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_IMMUTABLE },
          );
        }
        throw notFound("Project not found");
      }

      delete updateData.identifier;
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

    const updateResult = await prisma.project
      .updateMany({
        where: {
          id,
          workspaceId: workspaceContext.workspaceId,
        },
        data: updateData,
      })
      .catch((error: unknown) => {
        throw isProjectIdentifierUniqueConstraintError(error)
          ? conflict("Project identifier already in use in this workspace", {
              kind: CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
            })
          : error;
      });

    if (updateResult.count === 0) {
      throw notFound("Project not found");
    }
    await deliverCalendarInvalidationsNow(workspaceContext.workspaceId);

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
