import { Hono } from "hono";

import { getEnv } from "@/config/env";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { verifyAgentGrant } from "@/lib/image-studio/agent-grant";
import {
  assetContentPath,
  createImageJobRequestSchema,
} from "@/schemas/project-image-studio.schema";
import {
  getAsset,
  getJob,
  listAssets,
  listJobs,
} from "@/services/image-studio-assets.service";
import {
  createImageJob,
  DEFAULT_SETTINGS,
  reconcileProjectJobs,
} from "@/services/image-studio-jobs.service";
import {
  authorizeAgentSession,
  registerCreatedSession,
} from "@/services/image-studio-sessions.service";

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
  // "agent": only the agent may spend a grant here. The token Web mints for
  // the browser carries a different audience, so a page cannot call this
  // surface directly and bypass the agent.
  const verified = verifyAgentGrant(token, secret, "agent");
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
/**
 * Confirm the grant's user still has access to the grant's project.
 *
 * `authorize` above has already re-read that access from the database, so
 * reaching the handler at all is the answer.
 */
app.post("/access", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;
  return c.json({ ok: true });
});

/**
 * Record a conversation the agent has just created.
 *
 * The agent calls this inside the create request, before the new session id
 * has been returned to anybody. Only the agent can reach this surface — the
 * browser's token carries a different audience — so reaching it is itself the
 * proof of creation that possession of an id never was.
 */
app.post("/sessions", async (c) => {
  const context = await authorize(c.req.raw);
  if (context instanceof Response) return context;

  const body = (await c.req.json().catch(() => null)) as {
    eveSessionId?: unknown;
    title?: unknown;
  } | null;
  const eveSessionId =
    typeof body?.eveSessionId === "string" ? body.eveSessionId.trim() : "";
  if (!eveSessionId || eveSessionId.length > 200) {
    return c.json({ ok: false, error: "invalid_input" }, 400);
  }

  const session = await registerCreatedSession({
    projectId: context.projectId,
    userId: context.userId,
    eveSessionId,
    title: typeof body?.title === "string" ? body.title.slice(0, 200) : null,
  });
  return c.json({ ok: true, sessionId: session.id });
});

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

  // The same schema the session-authenticated route uses. Hand-rolled `typeof`
  // checks let a non-UUID reference reach Prisma as a 500, and let an
  // unsupported aspect ratio be written, counted against the hourly spend cap,
  // and only then refused by fal.
  const raw = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!raw) return c.json({ ok: false, error: "invalid_input" }, 400);

  const parsed = createImageJobRequestSchema.safeParse({
    ...raw,
    settings: {
      ...(typeof raw.aspectRatio === "string"
        ? { aspectRatio: raw.aspectRatio }
        : {}),
      ...(typeof raw.resolution === "string"
        ? { resolution: raw.resolution }
        : {}),
    },
  });
  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: "invalid_input",
        detail: parsed.error.issues[0]?.message,
      },
      400,
    );
  }
  const input = parsed.data;

  const job = await createImageJob({
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    referenceAssetIds: input.referenceAssetIds,
    parentAssetId: input.parentAssetId,
    idempotencyKey: input.idempotencyKey,
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

  const jobId = c.req.param("jobId");
  await reconcileProjectJobs(context.projectId);
  // By id, not by scanning a page: a busy project pushed older jobs out of the
  // window, and the agent then told the person their generation was gone.
  const job = await getJob({ ...context, jobId });
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
