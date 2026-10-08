import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  fileResourceSchema,
  updateFileMetadataRequestSchema,
} from "@/schemas/file-resource.schema";
import {
  assertFileEditAllowed,
  updateFileMetadata,
} from "@/services/file-metadata.service";
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

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/metadata",
    description: [
      "Edit the category, tags and confirmed projects of one file.",
      "",
      "Manual decisions are durable: removing an automatic tag records a",
      "rejection for that label, and setting a category pins the field, so a",
      "later re-extraction or model change cannot undo either. Confirming a",
      "project association changes no access at all.",
      "",
      "409 when someone else edited this document first; the client keeps its",
      "draft and the response carries the current revision.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      params: paramsSchema,
      query: querySchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: updateFileMetadataRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(fileResourceSchema, "Updated file"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    assertFileEditAllowed(context.actor);

    const outcome = await updateFileMetadata({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
      request: {
        expectedMetadataRevision: body.expectedMetadataRevision,
        addTagLabelIds: body.addTagLabelIds,
        removeTagLabelIds: body.removeTagLabelIds,
        categoryLabelId: body.categoryLabelId,
        confirmProjectIds: body.confirmProjectIds,
        removeProjectIds: body.removeProjectIds,
        allowSuggestionsFor: body.allowSuggestionsFor,
        allowSuggestionsForLabelIds: body.allowSuggestionsForLabelIds,
      },
    });

    if (outcome.status === "not-found") throw notFound("File unavailable");
    if (outcome.status === "conflict") {
      throw conflict("Updated elsewhere — review the changes");
    }

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
