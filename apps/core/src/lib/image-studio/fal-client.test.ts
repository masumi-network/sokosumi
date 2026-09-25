import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getEnv: () => ({ FAL_KEY: "test-key" }) }));

import {
  buildFalInput,
  falModelForKind,
  fetchQueueStatus,
  IMAGE_MODEL_EDIT,
  IMAGE_MODEL_GENERATE,
  parseImages,
  queueRequestModel,
  submitToQueue,
} from "@/lib/image-studio/fal-client";

describe("queueRequestModel", () => {
  it("drops a variant sub-path, because the queue's request routes ignore it", () => {
    // Verified live on 2026-09-25: polling under `/edit` answers 405, so a
    // refinement would poll forever and then settle as failed.
    expect(queueRequestModel(IMAGE_MODEL_EDIT)).toBe(IMAGE_MODEL_GENERATE);
  });

  it("leaves a plain owner/app id alone", () => {
    expect(queueRequestModel(IMAGE_MODEL_GENERATE)).toBe(IMAGE_MODEL_GENERATE);
  });
});

describe("buildFalInput", () => {
  it("omits image_urls for a text-to-image request", () => {
    const input = buildFalInput({
      prompt: "a cup",
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
      imageUrls: [],
    });
    // The base endpoint has no such field; sending one would be ignored.
    expect(input).not.toHaveProperty("image_urls");
    expect(input).not.toHaveProperty("seed");
  });

  it("carries references and a seed when they are given", () => {
    const input = buildFalInput({
      prompt: "a cup",
      aspectRatio: "16:9",
      resolution: "2K",
      outputFormat: "jpeg",
      seed: 7,
      imageUrls: ["https://v3b.fal.media/files/a.png"],
    });
    expect(input).toMatchObject({
      prompt: "a cup",
      aspect_ratio: "16:9",
      resolution: "2K",
      output_format: "jpeg",
      num_images: 1,
      seed: 7,
      image_urls: ["https://v3b.fal.media/files/a.png"],
    });
  });
});

describe("falModelForKind", () => {
  it("sends a refinement to the endpoint that accepts a reference", () => {
    expect(falModelForKind("EDIT")).toBe(IMAGE_MODEL_EDIT);
    expect(falModelForKind("GENERATE")).toBe(IMAGE_MODEL_GENERATE);
  });
});

describe("submitToQueue outcome classification", () => {
  it("treats a 4xx as a definite refusal, which is safe to retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad prompt", { status: 422 })),
    );
    await expect(
      submitToQueue({
        model: IMAGE_MODEL_GENERATE,
        input: {},
        webhookUrl: null,
      }),
    ).resolves.toMatchObject({ kind: "rejected", status: 422 });
    vi.unstubAllGlobals();
  });

  it("treats a 5xx as uncertain, because it may have been enqueued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(
      submitToQueue({
        model: IMAGE_MODEL_GENERATE,
        input: {},
        webhookUrl: null,
      }),
    ).resolves.toMatchObject({ kind: "uncertain" });
    vi.unstubAllGlobals();
  });

  it("treats a transport failure as uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );
    await expect(
      submitToQueue({
        model: IMAGE_MODEL_GENERATE,
        input: {},
        webhookUrl: null,
      }),
    ).resolves.toMatchObject({ kind: "uncertain", message: "socket hang up" });
    vi.unstubAllGlobals();
  });

  it("treats a 2xx with no request id as uncertain rather than queued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 200 })),
    );
    await expect(
      submitToQueue({
        model: IMAGE_MODEL_GENERATE,
        input: {},
        webhookUrl: null,
      }),
    ).resolves.toMatchObject({ kind: "uncertain" });
    vi.unstubAllGlobals();
  });

  it("registers a webhook only when one is supplied", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(url.toString());
        return Response.json({ request_id: "r1" }, { status: 200 });
      }),
    );
    await submitToQueue({
      model: IMAGE_MODEL_GENERATE,
      input: {},
      webhookUrl: "https://core.example.com/webhooks/fal/image-jobs",
    });
    await submitToQueue({
      model: IMAGE_MODEL_GENERATE,
      input: {},
      webhookUrl: null,
    });
    expect(calls[0]).toContain("fal_webhook=");
    expect(calls[1]).not.toContain("fal_webhook=");
    vi.unstubAllGlobals();
  });
});

describe("fetchQueueStatus", () => {
  it("polls the base model id for a variant endpoint", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        return Response.json({ status: "IN_QUEUE", queue_position: 2 });
      }),
    );
    await expect(
      fetchQueueStatus({ model: IMAGE_MODEL_EDIT, requestId: "r1" }),
    ).resolves.toEqual({ kind: "in_queue", queuePosition: 2 });
    expect(seen[0]).toBe(
      `https://queue.fal.run/${IMAGE_MODEL_GENERATE}/requests/r1/status`,
    );
    vi.unstubAllGlobals();
  });
});

describe("parseImages", () => {
  it("reads the payload shape the provider actually returns", () => {
    expect(
      parseImages({
        images: [
          {
            url: "https://v3b.fal.media/files/a.png",
            width: 1024,
            height: 1024,
            content_type: "image/png",
          },
        ],
        description: "a cup",
      }),
    ).toEqual([
      {
        url: "https://v3b.fal.media/files/a.png",
        width: 1024,
        height: 1024,
        contentType: "image/png",
      },
    ]);
  });

  it("tolerates a payload with no dimensions, which this model sometimes sends", () => {
    expect(
      parseImages({ images: [{ url: "https://v3b.fal.media/files/a.png" }] }),
    ).toEqual([
      {
        url: "https://v3b.fal.media/files/a.png",
        width: null,
        height: null,
        contentType: null,
      },
    ]);
  });

  it("ignores anything that is not a usable image entry", () => {
    expect(parseImages({ images: [null, {}, { url: "" }] })).toEqual([]);
    expect(parseImages(null)).toEqual([]);
  });
});
