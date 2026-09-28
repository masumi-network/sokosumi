import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { fileResourceSchema } from "@/schemas/file-resource.schema";
import {
  hydrateResources,
  loadLiveResources,
} from "@/services/file-search.service";

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

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: [
    "Get one file with the metadata this reader is authorized to see.",
    "A missing document and a denied one answer the same way, so the response",
    "never confirms that a file exists to someone who cannot open it.",
  ].join("\n"),
  tags: ["Drive"],
  request: { params: paramsSchema, query: querySchema },
  responses: {
    200: jsonSuccessResponse(fileResourceSchema, "File"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

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

    const resources = await loadLiveResources({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceIds: [id],
    });
    if (resources.length === 0) throw notFound("File unavailable");

    const [item] = await hydrateResources({ resources, query: null });
    return ok(c, fileResourceSchema.parse(item));
  });
}
