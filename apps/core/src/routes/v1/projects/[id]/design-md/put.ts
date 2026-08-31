import { createRoute, z } from "@hono/zod-openapi";

import { notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { uploadDesignMdContent } from "@/lib/design-md-blob";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  mapProjectForApi,
  projectDesignMdWriteSchema,
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
    method: "put",
    path: "/{id}/design-md",
    description: "Store and assign a project-owned DESIGN.md.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": { schema: projectDesignMdWriteSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project DESIGN.md updated"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    const designMdUrl = await uploadDesignMdContent({
      content: body.content,
      owner: { kind: "project", id },
      extractionId: body.extractionId,
    });
    if (!designMdUrl) {
      throw serviceUnavailable("Failed to store the DESIGN.md");
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        designMdUrl,
        designMdExtractionId: body.extractionId ?? null,
      },
    });

    return ok(c, mapProjectForApi(updated));
  });
}
