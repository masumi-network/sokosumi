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
import { refreshGoogleSheetLink } from "@/services/drive-google-sheet.service";
import {
  assertFileEditAllowed,
  loadEditableResource,
} from "@/services/file-metadata.service";

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
    method: "post",
    path: "/{id}/google-sheet/refresh",
    description: [
      "Read the linked Google Sheet now and rewrite the copy if it changed.",
      "A failure comes back in `error`; the copy stays as it was.",
    ].join("\n"),
    tags: ["Drive"],
    request: { params: paramsSchema, query: querySchema },
    responses: {
      200: jsonSuccessResponse(
        driveGoogleSheetSchema,
        "Google Sheet refreshed",
      ),
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
    assertFileEditAllowed(context.actor);
    const resource = await loadEditableResource({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
    });
    const link = resource ? await refreshGoogleSheetLink(resource.id) : null;
    if (!link) throw notFound("This file is not a linked Google Sheet");
    return ok(c, driveGoogleSheetSchema.parse(link));
  });
}
