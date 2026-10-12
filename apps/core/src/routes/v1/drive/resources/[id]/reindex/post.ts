import { createRoute, z } from "@hono/zod-openapi";
import { FileIndexJobPipeline } from "@sokosumi/database";

import { notFound, tooManyRequests } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { nudgeFileIndexing } from "@/lib/files/in-process-indexer";
import { requeueFileIndexJob } from "@/lib/files/index-jobs";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
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
  /** True when this request made work runnable that was not already. */
  queued: z.boolean(),
  /**
   * Which of the two happened, so a caller is not left inferring it from
   * a boolean.
   *
   * This route used to answer `{ queued: true }` unconditionally, and for
   * a document whose extraction and labelling had both succeeded it had
   * queued nothing at all — the case its own description names.
   */
  outcome: z.enum(["queued", "already-pending"]),
});

/** One manual retry per document per minute is plenty and bounds the cost. */
const REINDEX_COOLDOWN_MS = 60_000;

const route = withCoworkerContextHeaderParameters(
  createRoute({
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

    /**
     * A retry, not an enqueue.
     *
     * `enqueueFileIndexJob` computes its dedupe key from the resource,
     * pipeline, content revision, scope version and generation. This
     * route passed none of the last two, so it asked for the key the
     * original job already had: the upsert matched it, changed nothing,
     * and the requeue branch does not cover SUCCEEDED. A document with
     * EXTRACT and SUGGEST both succeeded — exactly the document this
     * route exists for — got a 200 and no work.
     *
     * `requeueFileIndexJob` mints a new generation instead, and leaves
     * already-pending work alone rather than paying for it twice.
     */
    const requeued = await requeueFileIndexJob({
      resourceId: resource.id,
      pipeline: FileIndexJobPipeline.EXTRACT,
      contentRevision: resource.contentRevision,
    });

    /**
     * Enqueuing is not enough on its own.
     *
     * Nothing else leases these jobs except the cron, and Vercel runs
     * crons on production deployments only — so on a preview this route
     * queued work that was never drained and silently did nothing. The
     * full nudge, not the extraction-only one: this is the path where a
     * reader has explicitly asked for this document to be processed, and
     * relabelling it is most of what they asked for.
     *
     * Deliberately after the cooldown above, so an explicit action stays
     * metered. Moving it earlier would turn one button into an unmetered
     * way to spend the provider budget.
     */
    /**
     * Unconditional, including when nothing new was queued.
     *
     * I had this behind `if (requeued.queued)` on the reasoning that
     * nudging for already-pending work wasted a request. That was wrong
     * twice over. A duplicate runner is a no-op by construction — the
     * job lease sees to it, which `in-process-indexer.ts` says in as
     * many words — so the guard bought nothing. And it broke the case
     * this button exists for.
     *
     * The nudge is capped at five extraction jobs and twenty seconds,
     * three and fifteen for suggestion, so it routinely returns with
     * work still QUEUED. On a preview, where no cron runs, the only two
     * drains in the repository are upload finalize and this route. So:
     * upload ten files, the finalize nudges hit their caps, several jobs
     * are left queued with nothing draining them, and a reader presses
     * reindex on one of those documents. The guard would find it already
     * QUEUED, skip the drain, and leave it stuck — the recovery button
     * failing in exactly the state it is for, which is the sentence
     * written about the bug this commit fixes.
     *
     * The cooldown above is the spend control, and it still is: one
     * press per document per minute.
     */
    nudgeFileIndexing();

    return ok(
      c,
      responseSchema.parse({
        queued: requeued.queued,
        outcome: requeued.queued ? "queued" : "already-pending",
      }),
    );
  });
}
