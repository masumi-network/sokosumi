import { createRoute, z } from "@hono/zod-openapi";
import { FileIndexJobPipeline } from "@sokosumi/database";

import { notFound, tooManyRequests } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { enqueueFileIndexJob } from "@/lib/files/index-jobs";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
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

const responseSchema = z.object({
  queued: z.boolean(),
});

/** One manual retry per document per minute is plenty and bounds the cost. */
const REINDEX_COOLDOWN_MS = 60_000;

const route = createRoute({
  method: "post",
  path: "/{id}/reindex",
  description: [
    "Queue this document for re-extraction.",
    "Rate limited, and it cannot bypass the provider budget. Manual metadata",
    "and dismissals survive: a reindex recomputes text, never decisions.",
  ].join("\n"),
  tags: ["Drive"],
  request: { params: paramsSchema, query: querySchema },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Reindex queued"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    429: jsonErrorResponse("Too Many Requests"),
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
    assertFileEditAllowed(context.actor);

    const resource = await loadEditableResource({
      workspaceId: context.workspaceId,
      actor: context.actor,
      resourceId: id,
    });
    if (!resource) throw notFound("File unavailable");

    const recent = await prisma.fileIndexJob.findFirst({
      where: {
        resourceId: resource.id,
        pipeline: FileIndexJobPipeline.EXTRACT,
        updatedAt: { gt: new Date(Date.now() - REINDEX_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) {
      throw tooManyRequests("This file was queued for processing a moment ago");
    }

    await enqueueFileIndexJob({
      resourceId: resource.id,
      pipeline: FileIndexJobPipeline.EXTRACT,
      contentRevision: resource.contentRevision,
    });

    return ok(c, responseSchema.parse({ queued: true }));
  });
}
