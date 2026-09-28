import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { workspaceLabelSchema } from "@/schemas/file-resource.schema";

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  kind: z.enum(["TAG", "CATEGORY"]).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: [
    "The workspace vocabulary: categories and tags.",
    "Archived entries keep historical assignments readable but take no new",
    "ones, and a merged entry is not listed — its id redirects instead.",
  ].join("\n"),
  tags: ["Drive"],
  request: { query: querySchema },
  responses: {
    200: jsonSuccessResponse(z.array(workspaceLabelSchema), "Workspace labels"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    const labels = await prisma.workspaceLabel.findMany({
      where: {
        workspaceId: context.workspaceId,
        kind: query.kind,
        mergedIntoId: null,
        ...(query.includeArchived === "true" ? {} : { archivedAt: null }),
      },
      orderBy: [{ kind: "asc" }, { normalizedName: "asc" }],
      select: {
        id: true,
        kind: true,
        displayName: true,
        description: true,
        archivedAt: true,
        vocabularyVersion: true,
      },
    });

    return ok(
      c,
      z.array(workspaceLabelSchema).parse(
        labels.map((label) => ({
          id: label.id,
          kind: label.kind,
          displayName: label.displayName,
          description: label.description,
          archived: label.archivedAt !== null,
          vocabularyVersion: label.vocabularyVersion,
        })),
      ),
    );
  });
}
