import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ getEnv: () => ({ FAL_KEY: "test-key" }) }));

import {
  buildFalInput,
  downloadImage,
  falModelForKind,
  fetchQueueStatus,
  IMAGE_MODEL_EDIT,
  IMAGE_MODEL_GENERATE,
  isAllowedMediaUrl,
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

describe("media URL allow-list", () => {
  it("accepts the provider's media hosts over https", () => {
    expect(isAllowedMediaUrl("https://v3b.fal.media/files/a.png")).toBe(true);
    expect(isAllowedMediaUrl("https://rest.fal.ai/x")).toBe(true);
  });

  it("refuses anything else", () => {
    // The URL comes from a provider payload, so it is input. Without this an
    // attacker-shaped payload could have Core fetch an internal address and
    // write the response into blob storage.
    expect(isAllowedMediaUrl("http://v3b.fal.media/a.png")).toBe(false);
    expect(isAllowedMediaUrl("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isAllowedMediaUrl("https://fal.media.evil.test/a.png")).toBe(false);
    expect(isAllowedMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedMediaUrl("not a url")).toBe(false);
  });
});

describe("downloadImage", () => {
  it("refuses a URL outside the allow-list before making any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadImage("https://internal.test/a.png", 1024),
    ).rejects.toThrow(/allowed provider host/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("re-checks every redirect hop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://169.254.169.254/latest/meta-data" },
          }),
      ),
    );
    // A permitted host must not be able to bounce us somewhere else.
    await expect(
      downloadImage("https://v3b.fal.media/files/a.png", 1024),
    ).rejects.toThrow(/allowed provider host/);
    vi.unstubAllGlobals();
  });

  it("stops a redirect loop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://v3b.fal.media/files/loop.png" },
          }),
      ),
    );
    await expect(
      downloadImage("https://v3b.fal.media/files/a.png", 1024),
    ).rejects.toThrow(/too many redirects/);
    vi.unstubAllGlobals();
  });

  it("stops reading once the limit is passed, without trusting content-length", async () => {
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array(64));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            // Understates the real size on purpose.
            headers: { "content-length": "8", "content-type": "image/png" },
          }),
      ),
    );

    await expect(
      downloadImage("https://v3b.fal.media/files/a.png", 128),
    ).rejects.toThrow(/larger than 128 bytes/);
    // Enforced as bytes arrive: a lying header cannot make Core buffer an
    // unbounded response first and check afterwards.
    expect(produced).toBeLessThan(10);
    vi.unstubAllGlobals();
  });

  it("returns the bytes when they fit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    await expect(
      downloadImage("https://v3b.fal.media/files/a.png", 1024),
    ).resolves.toMatchObject({ contentType: "image/png" });
    vi.unstubAllGlobals();
  });
});
