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
  fileSuggestionDecisionRequestSchema,
} from "@/schemas/file-resource.schema";
import {
  assertFileEditAllowed,
  decideFileSuggestion,
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
  suggestionId: z
    .string()
    .uuid()
    .openapi({ param: { name: "suggestionId", in: "path" } }),
});

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/suggestions/{suggestionId}/decision",
    description: [
      "Accept, dismiss or restore one suggestion.",
      "",
      "A dismissal is durable for this source revision and vocabulary policy:",
      "retrying or reindexing cannot bring the same suggestion back. Dismissing",
      "a category suggestion never clears a category the reader already set.",
      "",
      "`restore` withdraws a dismissal: the label goes back to suggested and the",
      "tombstone barring it is deleted. It is the only way back, and it exists",
      "because manual metadata editing — the only other code that cleared a",
      "tombstone — is gone.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      params: paramsSchema,
      query: querySchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: fileSuggestionDecisionRequestSchema },
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
    const { id, suggestionId } = c.req.valid("param");
    const query = c.req.valid("query");
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    assertFileEditAllowed(context.actor);

    const outcome = await decideFileSuggestion({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
      suggestionId,
      decision: body.decision,
      expectedMetadataRevision: body.expectedMetadataRevision,
    });

    if (outcome.status === "conflict") {
      throw conflict("Updated elsewhere — review the changes");
    }
    // Only `conflict` was handled, so a `not-found` or `forbidden` outcome
    // fell through to hydrate an empty list and `parse(undefined)` — a
    // ZodError, surfacing as a 500 on the path the route documents as 404.
    // Both answer the same way, so the response never confirms a suggestion
    // exists to someone who may not act on it.
    if (outcome.status !== "applied") {
      throw notFound("Suggestion unavailable");
    }

    const resources = await loadLiveResources({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceIds: [id],
    });
    const [item] = await hydrateResources({ resources, query: null });
    return ok(c, fileResourceSchema.parse(item));
  });
}
