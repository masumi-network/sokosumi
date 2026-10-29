import { z } from "@hono/zod-openapi";
import {
  APICallError,
  createGateway,
  experimental_getVideoStatus,
  experimental_startVideo,
  generateText,
  Output,
} from "ai";

import { getEnv } from "@/config/env";

/**
 * Everything the avatar pipeline buys, behind one small seam: an image edit,
 * a rewrite of the owner's words, and a looping video. All three go through AI
 * Gateway with `AI_GATEWAY_API_KEY`. Tests replace this module.
 */
export const AVATAR_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
export const AVATAR_REWRITER_MODEL = "anthropic/claude-haiku-5.5";
/** Honours a last frame, which the loop needs. Gateway's Wan does not. */
export const AVATAR_VIDEO_MODEL = "bytedance/seedance-v1.5-pro";

const IMAGE_TIMEOUT_MS = 120_000;
const REWRITE_TIMEOUT_MS = 20_000;
const VIDEO_REQUEST_TIMEOUT_MS = 30_000;
const LOOP_SECONDS = 4;

export interface RewrittenChange {
  /** One edit instruction for the image model; empty when nothing is allowed. */
  edit: string;
  note: string;
}

export type VideoPoll =
  | { status: "pending" }
  | { status: "completed"; video: Buffer }
  | { status: "failed"; reason: string };

/**
 * The video submit may have been accepted without us hearing about it (a
 * timeout, a dropped connection). The caller must not submit again.
 */
export class VideoSubmissionUncertainError extends Error {}

export interface AvatarProvider {
  /** One image edit: `system` is the house prompt, `reference` the current look. */
  editImage(input: {
    system: string;
    prompt: string;
    reference: Buffer;
  }): Promise<Buffer>;
  rewrite(input: { rules: string; request: string }): Promise<RewrittenChange>;
  /** Starts a 4 s, 1:1 loop with `imageUrl` as first and last frame. */
  startVideo(input: {
    prompt: string;
    imageUrl: string;
    idempotencyKey: string;
  }): Promise<unknown>;
  pollVideo(operation: unknown): Promise<VideoPoll>;
}

const rewriteSchema = z.object({ edit: z.string(), note: z.string() });

function gateway() {
  const apiKey = getEnv().AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not configured");
  return createGateway({ apiKey });
}

function createGatewayProvider(): AvatarProvider {
  return {
    async editImage({ system, prompt, reference }) {
      const result = await generateText({
        model: gateway().languageModel(AVATAR_IMAGE_MODEL),
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: reference },
              { type: "text", text: prompt },
            ],
          },
        ],
        providerOptions: {
          google: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "1:1" },
          },
        },
        // The row's attempt counter is the retry policy; a hidden retry here
        // would be a second paid call it cannot see.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      const image = result.files.find((file) =>
        file.mediaType.startsWith("image/"),
      );
      if (!image) throw new Error("The image model returned no image");
      return Buffer.from(image.uint8Array);
    },

    async rewrite({ rules, request }) {
      const result = await generateText({
        model: gateway().languageModel(AVATAR_REWRITER_MODEL),
        system: rules,
        // The owner's words are data for the rewriter, never instructions to it.
        prompt: request,
        output: Output.object({ schema: rewriteSchema }),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
      });
      return result.output;
    },

    async startVideo({ prompt, imageUrl, idempotencyKey }) {
      try {
        const started = await experimental_startVideo({
          model: gateway().videoModel(AVATAR_VIDEO_MODEL),
          prompt,
          aspectRatio: "1:1",
          resolution: "480x480",
          duration: LOOP_SECONDS,
          generateAudio: false,
          // A hosted URL, not bytes: Gateway caps async request bodies at 300 KiB.
          frameImages: [
            { image: imageUrl, frameType: "first_frame" },
            { image: imageUrl, frameType: "last_frame" },
          ],
          // The same key on a repeat call returns the same job.
          headers: { "idempotency-key": idempotencyKey },
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(VIDEO_REQUEST_TIMEOUT_MS),
        });
        return started.operation;
      } catch (error) {
        // A rejection with a status means the Gateway answered and refused.
        // Anything else (timeout, reset) may still have created the job.
        if (APICallError.isInstance(error) && error.statusCode !== undefined) {
          throw error;
        }
        throw new VideoSubmissionUncertainError(
          error instanceof Error ? error.message : "video submit failed",
        );
      }
    },

    async pollVideo(operation) {
      const status = await experimental_getVideoStatus(
        gateway().videoModel(AVATAR_VIDEO_MODEL),
        {
          operation: operation as never,
          abortSignal: AbortSignal.timeout(VIDEO_REQUEST_TIMEOUT_MS),
        },
      );
      if (status.status === "pending") return { status: "pending" };
      if (status.status === "error") {
        return { status: "failed", reason: String(status.error) };
      }
      const video = status.videos[0];
      if (!video) return { status: "failed", reason: "no video returned" };
      if (video.type === "binary") {
        return { status: "completed", video: Buffer.from(video.data) };
      }
      if (video.type === "base64") {
        return {
          status: "completed",
          video: Buffer.from(video.data, "base64"),
        };
      }
      const response = await fetch(video.url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new Error(`video download failed (${response.status})`);
      }
      return {
        status: "completed",
        video: Buffer.from(await response.arrayBuffer()),
      };
    },
  };
}

let provider: AvatarProvider | undefined;

export function avatarProvider(): AvatarProvider {
  provider ??= createGatewayProvider();
  return provider;
}
