import { Hono } from "hono";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { verifyAgentGrant } from "@/lib/image-studio/agent-grant";
import { assetContentPath } from "@/schemas/project-image-studio.schema";
import {
  getAsset,
  listAssets,
  listJobs,
} from "@/services/image-studio-assets.service";
import {
  createImageJob,
  DEFAULT_SETTINGS,
  reconcileProjectJobs,
} from "@/services/image-studio-jobs.service";
import { authorizeAgentSession } from "@/services/image-studio-sessions.service";

/**
 * The surface the image-studio agent calls.
 *
 * The agent runs outside Core, so it presents a grant naming the acting user
 * and project. A grant is an identity claim and nothing more: every handler
 * below re-derives that user's *current* access to that project from the
 * database, so a grant minted before a membership was revoked stops working
 * immediately.
 *
 * Deliberately small. The agent can describe what exists, start a generation,
 * and read job state — it cannot review, cannot delete, and cannot read image
 * bytes. Approval is a human decision, and the bytes have one authorized
 * route which requires a browser session.
 */

interface GrantContext {
  userId: string;
  projectId: string;
  workspaceId: string;
}

async function authorize(request: Request): Promise<GrantContext | Response> {
  const secret = getEnv().IMAGE_STUDIO_AGENT_SECRET;
  if (!secret) {
    // No secret configured means the agent surface is off, not open.
    return Response.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const verified = verifyAgentGrant(token, secret);
  if (!verified.ok) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // The grant says who; the database says whether they may. Still true even
  // when the grant is seconds old.
  const access = await requireProjectAccessForUser({
    projectId: verified.claims.projectId,
    userId: verified.claims.userId,
  });
  return {
    userId: access.userId,
    projectId: access.projectId,
    workspaceId: access.workspaceId,
  };
}

const app = new Hono();

/**
 * Authorize one operation on an eve session.
 *
 * Called by the agent's channel policy on every request that names a session,
 * before eve does anything with it. The answer is deliberately minimal: it
 * says yes or no, and nothing about the conversation.
 */
app.post("/sessions/:eveSessionId/authorize", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;

  const eveSessionId = c.req.param("eveSessionId");
  if (!eveSessionId) return c.json({ ok: false, error: "invalid_input" }, 400);

  const session = await authorizeAgentSession({
    eveSessionId,
    projectId: context.projectId,
    userId: context.userId,
  });
  return c.json({ ok: true, sessionId: session.id });
});

app.get("/versions", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;

  await reconcileProjectJobs(context.projectId);
  const [assetPage, jobs] = await Promise.all([
    listAssets({ ...context, limit: 40 }),
    listJobs({ ...context, limit: 20 }),
  ]);

  return c.json({
    ok: true,
    // No URLs. The agent describes versions; it never hands out a way to read
    // the bytes, and neither the model nor a tool result should carry one.
    versions: assetPage.assets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      lineageId: asset.rootId,
      parentId: asset.parentId,
      prompt: asset.prompt,
      createdAt: asset.createdAt.toISOString(),
      review: asset.review ? asset.review.decision : "UNDECIDED",
    })),
    activeJobs: jobs
      .filter((job) => job.assetId === null && job.settledAt === null)
      .map((job) => ({
        id: job.id,
        status: job.status,
        prompt: job.prompt,
      })),
  });
});

app.post("/generations", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;

  const body = (await c.req.json().catch(() => null)) as {
    prompt?: unknown;
    parentAssetId?: unknown;
    referenceAssetIds?: unknown;
    aspectRatio?: unknown;
    resolution?: unknown;
    idempotencyKey?: unknown;
    sessionId?: unknown;
  } | null;

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const idempotencyKey =
    typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (prompt.length === 0 || idempotencyKey.length < 8) {
    return c.json({ ok: false, error: "invalid_input" }, 400);
  }

  const referenceAssetIds = Array.isArray(body?.referenceAssetIds)
    ? body.referenceAssetIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (referenceAssetIds.length > LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB) {
    return c.json({ ok: false, error: "too_many_references" }, 400);
  }

  const job = await createImageJob({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : null,
    prompt,
    settings: {
      ...DEFAULT_SETTINGS,
      aspectRatio:
        typeof body?.aspectRatio === "string"
          ? body.aspectRatio
          : DEFAULT_SETTINGS.aspectRatio,
      resolution:
        typeof body?.resolution === "string"
          ? body.resolution
          : DEFAULT_SETTINGS.resolution,
    },
    referenceAssetIds,
    parentAssetId:
      typeof body?.parentAssetId === "string" ? body.parentAssetId : null,
    idempotencyKey,
  });

  return c.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      // Said plainly so the model has no excuse to promise otherwise.
      note:
        job.status === "SUBMISSION_UNCERTAIN"
          ? "The provider did not confirm this request. Do not resubmit it; tell the person and let them decide."
          : "Queued. Generation takes time; it is not instant.",
    },
  });
});

app.get("/generations/:jobId", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;

  await reconcileProjectJobs(context.projectId);
  const jobs = await listJobs({ ...context, limit: 50 });
  const job = jobs.find((candidate) => candidate.id === c.req.param("jobId"));
  if (!job) return c.json({ ok: false, error: "not_found" }, 404);

  const asset = job.assetId
    ? await getAsset({ ...context, assetId: job.assetId })
    : null;

  return c.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      error: job.error,
      retryMayDuplicateCharge: job.retryMayDuplicateCharge,
    },
    version: asset
      ? {
          id: asset.id,
          version: asset.version,
          lineageId: asset.rootId,
          review: asset.review ? asset.review.decision : "UNDECIDED",
        }
      : null,
  });
});

export default app;

export { assetContentPath };
