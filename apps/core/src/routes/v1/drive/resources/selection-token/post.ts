import { createRoute, z } from "@hono/zod-openapi";
import { FileResultWindowKind } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { badRequest } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { resolveScopeEpoch } from "@/lib/files/evidence-scope";
import {
  createResultWindow,
  decodeSearchCursor,
  encodeSearchCursor,
  loadResultWindow,
  SELECTION_TOKEN_TTL_MS,
} from "@/lib/files/search-session";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { fileSelectionTokenResponseSchema } from "@/schemas/file-resource.schema";
import { loadLiveResources } from "@/services/file-search.service";

const bodySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
  /** A cursor from the search response identifies the window to select. */
  windowCursor: z.string(),
});

const route = createRoute({
  method: "post",
  path: "/selection-token",
  description: [
    "Materialize 'select all N in this result window' into an explicit,",
    "short-lived set of ids and revisions.",
    "",
    "This is never 'all matching files'. It is exactly the bounded window the",
    "reader was shown, revalidated now: entries that changed are dropped and",
    "the revised count comes back for explicit reconfirmation.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bodySchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      fileSelectionTokenResponseSchema,
      "Selection token",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    const secret = getEnv().BETTER_AUTH_SECRET;
    const cursor = decodeSearchCursor(body.windowCursor, secret);
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
      throw badRequest("This result window expired — search again");
    }

    // Revalidate every pinned entry against current authorization and
    // revisions. What survives is the selection; nothing is discovered here.
    const live = await loadLiveResources({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceIds: loaded.window.entries.map((entry) => entry.r),
    });
    const byId = new Map(live.map((resource) => [resource.id, resource]));

    const eligible = loaded.window.entries.filter((entry) => {
      const current = byId.get(entry.r);
      return (
        current !== undefined &&
        current.contentRevision === entry.c &&
        current.metadataRevision === entry.m
      );
    });

    const selection = await createResultWindow({
      workspaceId: context.workspaceId,
      actor: context.actor,
      kind: FileResultWindowKind.SELECTION,
      bindingDigest: loaded.window.bindingDigest,
      epochVector,
      entries: eligible,
      truncated: loaded.window.truncated,
    });

    return created(
      c,
      fileSelectionTokenResponseSchema.parse({
        token: encodeSearchCursor({ v: 1, w: selection.id, p: 0 }, secret),
        count: eligible.length,
        expiresAt: new Date(Date.now() + SELECTION_TOKEN_TTL_MS).toISOString(),
      }),
    );
  });
}
