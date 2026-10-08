import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { fileRelatedResponseSchema } from "@/schemas/file-resource.schema";
import { findRelatedFiles } from "@/services/file-related.service";

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
    path: "/{id}/related",
    description: [
      "Up to six authorized documents related to this one.",
      "Excludes the seed and its whole version family. Never reports a count of",
      "neighbours the reader cannot open, and every reason uses metadata they",
      "can already see.",
    ].join("\n"),
    tags: ["Drive"],
    request: { params: paramsSchema, query: querySchema },
    responses: {
      200: jsonSuccessResponse(fileRelatedResponseSchema, "Related files"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    const result = await findRelatedFiles({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
    });

    return ok(c, fileRelatedResponseSchema.parse(result));
  });
}
