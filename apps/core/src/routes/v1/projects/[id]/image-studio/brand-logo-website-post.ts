import { createRoute, z } from "@hono/zod-openapi";

import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { resolveStudioWebsiteLogo } from "@/lib/site-icon";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/brand-kit/logo/website",
    operationId: "findStudioWebsiteLogo",
    description:
      "Stage a logo candidate from the project's saved website for review.",
    tags: ["Projects"],
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        z.object({ logo: z.url().nullable() }),
        "Website logo candidate, when found",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
      422: jsonErrorResponse("Project website is required"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ projectId, userId, workspaceId });
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { websiteUrl: true },
    });
    if (!project) throw notFound("Project not found");
    if (!project.websiteUrl)
      throw unprocessableEntity("Set a project website first");
    const logo = await resolveStudioWebsiteLogo(project.websiteUrl, projectId);
    return ok(c, { logo });
  });
}
