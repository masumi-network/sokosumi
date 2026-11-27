import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { readOrganizationDesignMd } from "@/helpers/design-md";
import { conflict, notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  readDesignMdContent,
  uploadDesignMdContent,
} from "@/lib/design-md-blob";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectForApi, projectSchema } from "@/schemas/project.schema";

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
    method: "post",
    path: "/{id}/design-md/from-organization",
    description:
      "Copy the workspace organization's DESIGN.md into a Project that has none, as the Project's own file. Never replaces a Project DESIGN.md: 409 `project_design_md_exists` when the Project has one, including one saved while copying.",
    tags: ["Projects"],
    request: { params: paramsSchema },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project DESIGN.md copied"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse(
        "Project not found, or the organization has no DESIGN.md",
      ),
      409: jsonErrorResponse(
        "The Project already has a DESIGN.md, or is a read-only CMO Project",
      ),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

function alreadyHasDesignMd() {
  return conflict("Project already has a DESIGN.md", {
    kind: CORE_API_ERROR_KINDS.PROJECT_DESIGN_MD_EXISTS,
  });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");

    const project = await prisma.project.findFirst({
      where: { id, workspaceId: workspaceContext.workspaceId },
      select: { id: true, designMdUrl: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }
    if (project.designMdUrl) {
      throw alreadyHasDesignMd();
    }

    const organization = workspaceContext.organizationId
      ? await prisma.organization.findUnique({
          where: { id: workspaceContext.organizationId },
          select: { metadata: true },
        })
      : null;
    const source = readOrganizationDesignMd(organization?.metadata);
    if (!source) {
      throw notFound("The organization has no DESIGN.md", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_DESIGN_MD_MISSING,
      });
    }

    const content = await readDesignMdContent(source.url);
    if (!content) {
      throw serviceUnavailable("Failed to read the organization DESIGN.md");
    }
    const designMdUrl = await uploadDesignMdContent({
      content,
      owner: { kind: "project", id },
    });
    if (!designMdUrl) {
      throw serviceUnavailable("Failed to store the DESIGN.md");
    }

    // The empty check is part of the write, so a brand saved after the check
    // above wins and this copy is refused. The uploaded blob is
    // content-addressed and simply goes unreferenced.
    const updated = await prisma.project
      .update({
        where: { id, designMdUrl: null },
        data: { designMdUrl, designMdExtractionId: null },
      })
      .catch((error: unknown) => {
        if (isPrismaRecordNotFoundError(error)) throw alreadyHasDesignMd();
        throw error;
      });

    // cmoProjectLock refused this write on a CMO Project.
    return ok(c, mapProjectForApi(updated, { cmo: false }));
  });
}
