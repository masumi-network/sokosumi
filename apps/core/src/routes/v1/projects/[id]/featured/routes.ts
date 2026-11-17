import { createRoute, z } from "@hono/zod-openapi";

import { lockCalendarScope } from "@/helpers/calendar-locks";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireCanFeatureProjects } from "@/helpers/project-featured";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectFeatureSchema } from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

const responses = {
  200: jsonSuccessResponse(projectFeatureSchema, "The featured Project"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
};

const putRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/featured",
    tags: ["Projects"],
    description:
      "Feature this Project for every member of the active organization workspace, replacing the one featured before. Owners and admins only; a personal workspace has nothing to feature. A closing or closed Project cannot be featured.",
    request: { params: paramsSchema },
    responses,
  }),
);

const deleteRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/featured",
    tags: ["Projects"],
    description:
      "Stop featuring this Project in the active organization workspace. Owners and admins only. A no-op when another Project is featured by now; the answer says which Project is featured after the call.",
    request: { params: paramsSchema },
    responses,
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(putRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId, organizationId } = requireWorkspaceContext(
      c.var.workspaceContext,
    );
    const { id } = c.req.valid("param");
    await requireCanFeatureProjects(userId, organizationId);

    // Check and write under the close's locks, in its order (actor,
    // Workspace, Project), so a close cannot commit between them. The write
    // to the Workspace row also fails a Serializable close that read it
    // before, which then retries and sees the feature.
    const projectId = await serializableTransaction(async (tx) => {
      // Scoped to the active workspace, so another workspace's id reads as absent.
      if (!(await lockCalendarScope(tx, workspaceId, [id], userId))) {
        throw notFound("Project not found");
      }
      const project = await tx.project.findFirstOrThrow({
        where: { id, workspaceId },
        select: { id: true, closedAt: true, closingAt: true },
      });
      if (project.closedAt || project.closingAt) {
        throw unprocessableEntity(
          "A closing or closed Project can't be featured",
        );
      }
      // One column, so featuring replaces the previous Project in one write.
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { featuredProjectId: project.id },
      });
      return project.id;
    }, "The Project changed while it was being featured. Try again.");
    return ok(c, projectFeatureSchema.parse({ featuredProjectId: projectId }));
  });

  app.openapi(deleteRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { workspaceId, organizationId } = requireWorkspaceContext(
      c.var.workspaceContext,
    );
    const { id } = c.req.valid("param");
    await requireCanFeatureProjects(userId, organizationId);

    // Only while this Project still holds it, so a stale Stop featuring never
    // clears a Project another admin featured since. Answers with what is
    // featured now.
    await prisma.workspace.updateMany({
      where: { id: workspaceId, featuredProjectId: id },
      data: { featuredProjectId: null },
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { featuredProjectId: true },
    });
    return ok(c, projectFeatureSchema.parse(workspace));
  });
}
