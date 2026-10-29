import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateTextMock,
  getEnvMock,
  getVideoStatusMock,
  languageModelMock,
  startVideoMock,
  videoModelMock,
} = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  getEnvMock: vi.fn(),
  getVideoStatusMock: vi.fn(),
  languageModelMock: vi.fn((id: string) => ({ language: id })),
  startVideoMock: vi.fn(),
  videoModelMock: vi.fn((id: string) => ({ video: id })),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  createGateway: () => ({
    languageModel: languageModelMock,
    videoModel: videoModelMock,
  }),
  generateText: generateTextMock,
  experimental_startVideo: startVideoMock,
  experimental_getVideoStatus: getVideoStatusMock,
}));

import {
  AVATAR_IMAGE_MODEL,
  AVATAR_REWRITER_MODEL,
  AVATAR_VIDEO_MODEL,
  avatarProvider,
  VideoSubmissionUncertainError,
} from "./provider";

const STILL_URL = "https://blob.test/still.webp";

function apiError(statusCode: number | undefined) {
  return new APICallError({
    message: "nope",
    url: "https://gateway.test",
    requestBodyValues: {},
    statusCode,
  });
}

describe("avatar provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getEnvMock.mockReturnValue({ AI_GATEWAY_API_KEY: "gw-test" });
  });

  it("needs the gateway key", async () => {
    getEnvMock.mockReturnValue({});

    await expect(
      avatarProvider().editImage({
        system: "s",
        prompt: "p",
        reference: Buffer.from("x"),
      }),
    ).rejects.toThrow("AI_GATEWAY_API_KEY");
  });

  describe("editImage", () => {
    it("edits the reference under the system prompt, once, as a square", async () => {
      generateTextMock.mockResolvedValue({
        files: [
          { mediaType: "text/plain", uint8Array: new Uint8Array([9]) },
          { mediaType: "image/png", uint8Array: new Uint8Array([1, 2, 3]) },
        ],
      });
      const reference = Buffer.from("ref");

      const image = await avatarProvider().editImage({
        system: "HOUSE",
        prompt: "make it blue",
        reference,
      });

      expect(image).toEqual(Buffer.from([1, 2, 3]));
      expect(languageModelMock).toHaveBeenCalledWith(AVATAR_IMAGE_MODEL);
      const call = generateTextMock.mock.calls[0]?.[0];
      expect(call.system).toBe("HOUSE");
      expect(call.messages[0].content).toEqual([
        { type: "image", image: reference },
        { type: "text", text: "make it blue" },
      ]);
      expect(call.providerOptions.google).toMatchObject({
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      });
      // A hidden retry would be a second paid call the row cannot see.
      expect(call.maxRetries).toBe(0);
    });

    it("throws when the model answered without an image", async () => {
      generateTextMock.mockResolvedValue({
        files: [{ mediaType: "text/plain", uint8Array: new Uint8Array([9]) }],
      });

      await expect(
        avatarProvider().editImage({
          system: "s",
          prompt: "p",
          reference: Buffer.from("x"),
        }),
      ).rejects.toThrow("no image");
    });
  });

  describe("rewrite", () => {
    it("asks the rewriter for the structured edit and note", async () => {
      generateTextMock.mockResolvedValue({
        output: { edit: "Add a hat.", note: "Made it clay." },
      });

      const result = await avatarProvider().rewrite({
        rules: "RULES",
        request: "a hat",
      });

      expect(result).toEqual({ edit: "Add a hat.", note: "Made it clay." });
      expect(languageModelMock).toHaveBeenCalledWith(AVATAR_REWRITER_MODEL);
      const call = generateTextMock.mock.calls[0]?.[0];
      expect(call.system).toBe("RULES");
      // The request is the prompt, never part of the system rules.
      expect(call.prompt).toBe("a hat");
      expect(call.output).toBeDefined();
      expect(call.maxRetries).toBe(1);
    });
  });

  describe("startVideo", () => {
    it("uses the hosted still as first and last frame, with no hidden retries", async () => {
      startVideoMock.mockResolvedValue({ operation: { job: "j1" } });

      const operation = await avatarProvider().startVideo({
        prompt: "wave",
        imageUrl: STILL_URL,
        idempotencyKey: "key-1",
      });

      expect(operation).toEqual({ job: "j1" });
      expect(videoModelMock).toHaveBeenCalledWith(AVATAR_VIDEO_MODEL);
      const call = startVideoMock.mock.calls[0]?.[0];
      expect(call.frameImages).toEqual([
        { image: STILL_URL, frameType: "first_frame" },
        { image: STILL_URL, frameType: "last_frame" },
      ]);
      expect(call).toMatchObject({
        prompt: "wave",
        aspectRatio: "1:1",
        duration: 4,
        generateAudio: false,
        maxRetries: 0,
        headers: { "idempotency-key": "key-1" },
      });
    });

    it("rejects a start that came back without an operation", async () => {
      startVideoMock.mockResolvedValue({ operation: null });

      await expect(
        avatarProvider().startVideo({
          prompt: "p",
          imageUrl: STILL_URL,
          idempotencyKey: "k",
        }),
      ).rejects.toBeInstanceOf(VideoSubmissionUncertainError);
    });

    it("passes on a refusal the Gateway answered with a status: nothing was billed", async () => {
      const refusal = apiError(400);
      startVideoMock.mockRejectedValue(refusal);

      await expect(
        avatarProvider().startVideo({
          prompt: "p",
          imageUrl: STILL_URL,
          idempotencyKey: "k",
        }),
      ).rejects.toBe(refusal);
    });

    it.each([
      ["an API error with no status", apiError(undefined)],
      ["a dropped connection", new Error("socket hang up")],
      ["a timeout", new DOMException("timed out", "TimeoutError")],
    ])("calls %s uncertain: the job may exist", async (_name, error) => {
      startVideoMock.mockRejectedValue(error);

      await expect(
        avatarProvider().startVideo({
          prompt: "p",
          imageUrl: STILL_URL,
          idempotencyKey: "k",
        }),
      ).rejects.toBeInstanceOf(VideoSubmissionUncertainError);
    });
  });

  describe("pollVideo", () => {
    it("is pending while the job runs", async () => {
      getVideoStatusMock.mockResolvedValue({ status: "pending" });

      await expect(avatarProvider().pollVideo({ job: "j1" })).resolves.toEqual({
        status: "pending",
      });
      expect(getVideoStatusMock.mock.calls[0]?.[1].operation).toEqual({
        job: "j1",
      });
    });

    it("reports the provider's failure", async () => {
      getVideoStatusMock.mockResolvedValue({
        status: "error",
        error: "content filtered",
      });

      await expect(avatarProvider().pollVideo({ job: "j1" })).resolves.toEqual({
        status: "failed",
        reason: "content filtered",
      });
    });

    it("fails a completed job that has no video", async () => {
      getVideoStatusMock.mockResolvedValue({ status: "completed", videos: [] });

      await expect(avatarProvider().pollVideo({ job: "j1" })).resolves.toEqual({
        status: "failed",
        reason: "no video returned",
      });
    });

    it.each([
      [
        "binary",
        {
          type: "binary",
          data: new Uint8Array([1, 2]),
          mediaType: "video/mp4",
        },
      ],
      ["base64", { type: "base64", data: "AQI=", mediaType: "video/mp4" }],
    ])("returns the bytes of a %s video", async (_name, video) => {
      getVideoStatusMock.mockResolvedValue({
        status: "completed",
        videos: [video],
      });

      await expect(avatarProvider().pollVideo({ job: "j1" })).resolves.toEqual({
        status: "completed",
        video: Buffer.from([1, 2]),
      });
    });

    it("downloads a hosted video", async () => {
      getVideoStatusMock.mockResolvedValue({
        status: "completed",
        videos: [
          {
            type: "url",
            url: "https://video.test/a.mp4",
            mediaType: "video/mp4",
          },
        ],
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([7, 8]).buffer,
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(avatarProvider().pollVideo({ job: "j1" })).resolves.toEqual({
        status: "completed",
        video: Buffer.from([7, 8]),
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://video.test/a.mp4");
    });

    it("throws when the hosted video cannot be fetched, so the tick tries again", async () => {
      getVideoStatusMock.mockResolvedValue({
        status: "completed",
        videos: [
          {
            type: "url",
            url: "https://video.test/a.mp4",
            mediaType: "video/mp4",
          },
        ],
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 502 }),
      );

      await expect(avatarProvider().pollVideo({ job: "j1" })).rejects.toThrow(
        "502",
      );
    });
  });
});
