import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route that produced the blocking defect.
 *
 * A generation failed on the preprod preview (project
 * `01a0e53c-34c5-76f8-8546-f007175b92de`, job
 * `01a0e585-473f-7381-9cc3-fcef2989e9a4`) and read back as `status: FAILED`,
 * `credits: 8`, `refunded: false`, `error: "Unexpected status code: 422"`. The
 * account was eight credits down and stayed down.
 *
 * The cause was here, not in the jobs service. fal's completion callback is the
 * path a runner error takes, and this handler wrote `FAILED` with an `updateMany`
 * of its own — so it was the one terminal-failure path that never refunded, and
 * the one that stored fal's raw transport text verbatim. Both halves are pinned
 * below: the delivery must settle through `failImageJob`, and the raw string must
 * not reach the row.
 */

const { failImageJobMock, settleWithImageMock, jobFindUniqueMock, verifyMock } =
  vi.hoisted(() => ({
    failImageJobMock: vi.fn(),
    settleWithImageMock: vi.fn(),
    jobFindUniqueMock: vi.fn(),
    verifyMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { projectImageJob: { findUnique: jobFindUniqueMock } },
}));

vi.mock("@/services/image-studio-jobs.service", () => ({
  failImageJob: failImageJobMock,
  settleWithImage: settleWithImageMock,
}));

vi.mock("@/lib/image-studio/fal-webhook", async () => ({
  ...(await vi.importActual<typeof import("@/lib/image-studio/fal-webhook")>(
    "@/lib/image-studio/fal-webhook",
  )),
  verifyFalWebhook: verifyMock,
}));

import { mountFalImageJobsWebhook } from "@/routes/webhooks/fal/image-jobs";

const app = new Hono();
mountFalImageJobsWebhook(app);

const REQUEST_ID = "fal-request-1";
const JOB_ID = "01a0e585-473f-7381-9cc3-fcef2989e9a4";

async function deliver(body: unknown) {
  return await app.request("/fal/image-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue({ ok: true });
  jobFindUniqueMock.mockResolvedValue({ id: JOB_ID, status: "QUEUED" });
  failImageJobMock.mockResolvedValue(undefined);
  settleWithImageMock.mockResolvedValue(undefined);
});

describe("fal completion callback", () => {
  it("settles a provider error through the service, so the charge is refunded", async () => {
    const response = await deliver({
      request_id: REQUEST_ID,
      status: "ERROR",
      error: "Unexpected status code: 422",
    });

    expect(response.status).toBe(200);
    // Through `failImageJob` and nowhere else. This handler writing FAILED itself
    // is exactly what left a failed generation paid for.
    expect(failImageJobMock).toHaveBeenCalledExactlyOnceWith(
      JOB_ID,
      "provider_error",
      "Unexpected status code: 422",
    );
    expect(settleWithImageMock).not.toHaveBeenCalled();
  });

  it("passes the provider's raw text only as detail, never as the reason", async () => {
    await deliver({
      request_id: REQUEST_ID,
      status: "ERROR",
      error: "Unexpected status code: 422",
    });

    // The reason is a stable code. The raw transport string is the third
    // argument, which `failImageJob` logs and does not store — it is not
    // something a person waiting for an image can act on.
    const [, reason] = failImageJobMock.mock.calls[0]!;
    expect(reason).toBe("provider_error");
  });

  it("still names a reason when fal sends no error text", async () => {
    await deliver({ request_id: REQUEST_ID, status: "ERROR" });

    expect(failImageJobMock).toHaveBeenCalledExactlyOnceWith(
      JOB_ID,
      "provider_error",
      undefined,
    );
  });

  it("settles a success with the image and never fails the job", async () => {
    await deliver({
      request_id: REQUEST_ID,
      status: "OK",
      payload: {
        images: [
          {
            url: "https://v3b.fal.media/files/a.png",
            width: 1344,
            height: 768,
          },
        ],
      },
    });

    // The provider's dimensions go with the URL. Dropping them here is half of why
    // stored assets read 0x0 in the lightbox.
    expect(settleWithImageMock).toHaveBeenCalledExactlyOnceWith(
      JOB_ID,
      "https://v3b.fal.media/files/a.png",
      { width: 1344, height: 768 },
    );
    expect(failImageJobMock).not.toHaveBeenCalled();
  });

  it("touches nothing for an unverified delivery", async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: "signature_mismatch" });

    const response = await deliver({
      request_id: REQUEST_ID,
      status: "ERROR",
      error: "boom",
    });

    expect(response.status).toBe(401);
    expect(failImageJobMock).not.toHaveBeenCalled();
    expect(jobFindUniqueMock).not.toHaveBeenCalled();
  });

  it("ignores a request id it does not know, rather than failing something else", async () => {
    jobFindUniqueMock.mockResolvedValue(null);

    const response = await deliver({
      request_id: "someone-elses-request",
      status: "ERROR",
      error: "boom",
    });

    expect(response.status).toBe(200);
    expect(failImageJobMock).not.toHaveBeenCalled();
  });

  it("scopes the job by our own request id, never by anything in the payload", async () => {
    await deliver({
      request_id: REQUEST_ID,
      status: "ERROR",
      error: "boom",
      // A hostile payload naming a different job. Signature verification already
      // stops a forged body, but scope still comes from our row.
      job_id: "00000000-0000-4000-8000-000000000999",
    });

    expect(jobFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { falRequestId: REQUEST_ID } }),
    );
    expect(failImageJobMock).toHaveBeenCalledWith(
      JOB_ID,
      "provider_error",
      "boom",
    );
  });
});
