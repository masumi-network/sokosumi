import { ProjectImageJobStatus } from "@sokosumi/database";
import { Hono } from "hono";

import prisma from "@/lib/db/prisma";
import { parseImages } from "@/lib/image-studio/fal-client";
import {
  readWebhookHeaders,
  verifyFalWebhook,
} from "@/lib/image-studio/fal-webhook";
import { settleWithImage } from "@/services/image-studio-jobs.service";

/**
 * fal's completion callback.
 *
 * There is no session here, so authentication is entirely cryptographic:
 * ED25519 over the raw bytes, against fal's published keys, inside a five
 * minute window. Everything that follows is derived from *our* job row, never
 * from the payload — the body names a request id and nothing else it says
 * about scope is trusted.
 *
 * Failures answer 200 on purpose once the signature checks out. fal retries a
 * non-2xx up to 31 times, and retrying will not fix a payload we have already
 * looked at and decided about.
 */
export function mountFalImageJobsWebhook(app: Hono): void {
  app.post("/fal/image-jobs", async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());

    const verification = await verifyFalWebhook({
      headers: readWebhookHeaders(c.req.raw.headers),
      rawBody: raw,
    });
    if (!verification.ok) {
      console.warn("[webhooks/fal] rejected delivery", {
        reason: verification.reason,
      });
      // 401 rather than 200: an unverified caller gets no signal that the
      // request id it guessed exists, and a genuine delivery that failed
      // verification should be retried rather than silently dropped.
      return c.json({ ok: false }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return c.json({ ok: true, ignored: "unparseable" }, 200);
    }

    const body = payload as {
      request_id?: unknown;
      status?: unknown;
      payload?: unknown;
      error?: unknown;
    };
    const requestId =
      typeof body.request_id === "string" ? body.request_id : null;
    if (!requestId) return c.json({ ok: true, ignored: "no_request_id" }, 200);

    // Scope comes from here, not from anything fal sent.
    const job = await prisma.projectImageJob.findUnique({
      where: { falRequestId: requestId },
      select: { id: true, status: true },
    });
    if (!job) return c.json({ ok: true, ignored: "unknown_request" }, 200);

    if (body.status === "ERROR") {
      await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
          },
        },
        data: {
          status: ProjectImageJobStatus.FAILED,
          error:
            typeof body.error === "string"
              ? body.error.slice(0, 500)
              : "The provider reported an error.",
          settledAt: new Date(),
        },
      });
      return c.json({ ok: true }, 200);
    }

    const images = parseImages(body.payload);
    if (images.length === 0) {
      return c.json({ ok: true, ignored: "no_image" }, 200);
    }

    // Idempotent: the asset row is unique per job, so a webhook racing a poll
    // produces one version and one of them loses the insert.
    await settleWithImage(job.id, images[0]!.url);
    return c.json({ ok: true }, 200);
  });
}

const app = new Hono();
mountFalImageJobsWebhook(app);
export default app;
