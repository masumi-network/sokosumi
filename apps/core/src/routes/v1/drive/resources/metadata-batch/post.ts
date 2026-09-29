import { createRoute, z } from "@hono/zod-openapi";
import { getEnv } from "@/config/env";
import { badRequest, unprocessableEntity } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { resolveScopeEpoch } from "@/lib/files/evidence-scope";
import {
  BULK_SYNCHRONOUS_MAX,
  decodeSearchCursor,
  loadResultWindow,
} from "@/lib/files/search-session";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  fileMetadataBatchRequestSchema,
  fileMetadataBatchResponseSchema,
} from "@/schemas/file-resource.schema";
import {
  assertFileEditAllowed,
  type MetadataEditOutcome,
  updateFileMetadata,
} from "@/services/file-metadata.service";
import { loadLiveResources } from "@/services/file-search.service";

const bodySchema = fileMetadataBatchRequestSchema.extend({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = createRoute({
  method: "post",
  path: "/metadata-batch",
  description: [
    "Apply one metadata change to explicit ids, or to a selection token.",
    "",
    "At most 100 documents are edited synchronously, and the set never grows:",
    "a token materializes the window the reader saw, and nothing is discovered",
    "asynchronously. Every item is authorized and revision-checked on its own,",
    "so a partial failure returns per-item outcomes and the caller keeps the",
    "failed rows selected.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bodySchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      fileMetadataBatchResponseSchema,
      "Per-item outcomes",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId ?? undefined,
    });
    assertFileEditAllowed(context.actor);

    let targets: { resourceId: string; metadataRevision: number | null }[] = [];
    // Only set when a selection window moved and the caller must reconfirm.
    const revisedCount: number | null = null;

    if (body.selectionToken) {
      const secret = getEnv().BETTER_AUTH_SECRET;
      const cursor = decodeSearchCursor(body.selectionToken, secret);
      const epochVector = await resolveScopeEpoch({
        workspaceId: context.workspaceId,
        actor: context.actor,
      });
      const loaded = await loadResultWindow({
        windowId: cursor.w,
        workspaceId: context.workspaceId,
        actor: context.actor,
        epochVector,
      });
      if ("failure" in loaded) {
        throw badRequest("This selection expired — search again");
      }

      const live = await loadLiveResources({
        workspaceId: context.workspaceId,
        actor: context.actor,
        resourceIds: loaded.window.entries.map((entry) => entry.r),
      });
      const byId = new Map(live.map((resource) => [resource.id, resource]));

      const stillEligible = loaded.window.entries.filter((entry) => {
        const current = byId.get(entry.r);
        return (
          current !== undefined &&
          current.contentRevision === entry.c &&
          current.metadataRevision === entry.m
        );
      });

      // The window moved between selecting and applying. Return the revised
      // count and change nothing, so the reader reconfirms what they meant.
      if (stillEligible.length !== loaded.window.entries.length) {
        return ok(
          c,
          fileMetadataBatchResponseSchema.parse({
            outcomes: [],
            revisedCount: stillEligible.length,
          }),
        );
      }

      targets = stillEligible.map((entry) => ({
        resourceId: entry.r,
        metadataRevision: entry.m,
      }));
    } else if (body.resourceIds?.length) {
      const expected = new Map(
        (body.expectedRevisions ?? []).map((entry) => [
          entry.resourceId,
          entry.metadataRevision,
        ]),
      );
      targets = body.resourceIds.map((resourceId) => ({
        resourceId,
        metadataRevision: expected.get(resourceId) ?? null,
      }));
    } else {
      throw unprocessableEntity("Provide resourceIds or a selectionToken");
    }

    if (targets.length > BULK_SYNCHRONOUS_MAX) {
      throw unprocessableEntity(
        `At most ${BULK_SYNCHRONOUS_MAX} files can be edited in one request`,
      );
    }

    const outcomes: MetadataEditOutcome[] = [];
    for (const target of targets) {
      if (target.metadataRevision === null) {
        outcomes.push({
          resourceId: target.resourceId,
          status: "conflict",
          metadataRevision: null,
        });
        continue;
      }
      outcomes.push(
        await updateFileMetadata({
          workspaceId: context.workspaceId,
          actor: context.actor,
          resourceId: target.resourceId,
          request: {
            expectedMetadataRevision: target.metadataRevision,
            addTagLabelIds: body.addTagLabelIds,
            removeTagLabelIds: body.removeTagLabelIds,
            categoryLabelId: body.categoryLabelId,
          },
        }),
      );
    }

    return ok(
      c,
      fileMetadataBatchResponseSchema.parse({ outcomes, revisedCount }),
    );
  });
}
