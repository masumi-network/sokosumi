import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
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
      409: jsonErrorResponse(
        "CMO project is read-only, or onlyIfEmpty and the Project has a DESIGN.md",
      ),
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
      select: { id: true, designMdUrl: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }
    if (body.onlyIfEmpty && project.designMdUrl) {
      throw conflict("Project already has a DESIGN.md");
    }

    const designMdUrl = await uploadDesignMdContent({
      content: body.content,
      owner: { kind: "project", id },
      extractionId: body.extractionId,
    });
    if (!designMdUrl) {
      throw serviceUnavailable("Failed to store the DESIGN.md");
    }

    // With onlyIfEmpty the empty check is part of the write, so a brand saved
    // after the check above wins and this write is refused. The uploaded blob
    // is content-addressed and simply goes unreferenced.
    const updated = await prisma.project
      .update({
        where: body.onlyIfEmpty ? { id, designMdUrl: null } : { id },
        data: {
          designMdUrl,
          designMdExtractionId: body.extractionId ?? null,
        },
      })
      .catch((error: unknown) => {
        if (body.onlyIfEmpty && isPrismaRecordNotFoundError(error)) {
          throw conflict("Project already has a DESIGN.md");
        }
        throw error;
      });

    return ok(
      c,
      mapProjectForApi(updated, {
        // cmoProjectLock refused this write on a CMO Project.
        cmo: false,
      }),
    );
  });
}
