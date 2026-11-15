import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveFileScopeSchema,
  driveGoogleSheetSchema,
} from "@/schemas/drive-file.schema";
import { findGoogleSheetLink } from "@/services/drive-google-sheet.service";
import { loadEditableResource } from "@/services/file-metadata.service";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/google-sheet",
    description:
      "The Google Sheet this file copies. 404 for a plain file, and for one the caller cannot see.",
    tags: ["Drive"],
    request: { params: paramsSchema, query: querySchema },
    responses: {
      200: jsonSuccessResponse(driveGoogleSheetSchema, "Linked Google Sheet"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const context = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    const resource = await loadEditableResource({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
    });
    const link = resource ? await findGoogleSheetLink(resource.id) : null;
    if (!link) throw notFound("This file is not a linked Google Sheet");
    return ok(c, driveGoogleSheetSchema.parse(link));
  });
}
