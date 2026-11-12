import { setTimeout as delay } from "node:timers/promises";
import {
  type SocialPostMediaKind,
  socialPostMaxBytesForKind,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import sharp from "sharp";

import {
  ComposioApiError,
  deleteComposioToolSession,
} from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  createComposioToolSession,
  executeComposioTool,
  guardSocialCreateOutcome,
  stageSocialPublishFile,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostMediaBytes,
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import {
  downloadSocialPostMedia,
  SocialPostMediaError,
} from "@/helpers/social-post-media";
import { classifyPublishError } from "@/helpers/social-post-publish-errors";

const X_CREATE_POST_TOOL_SLUG = "TWITTER_CREATION_OF_A_POST";

type XPublishToolSlug =
  | "TWITTER_UPLOAD_MEDIA"
  | "TWITTER_UPLOAD_LARGE_MEDIA"
  | "TWITTER_GET_MEDIA_UPLOAD_STATUS"
  | typeof X_CREATE_POST_TOOL_SLUG;

/** Tools a publish session may execute, with the wording used when each fails. */
const X_PUBLISH_TOOL_STEPS: Record<
  XPublishToolSlug,
  { context: string; refused: string }
> = {
  TWITTER_UPLOAD_MEDIA: {
    context: "upload X image",
    refused: "X could not upload the image",
  },
  TWITTER_UPLOAD_LARGE_MEDIA: {
    context: "upload X video or GIF",
    refused: "X refused the media upload",
  },
  TWITTER_GET_MEDIA_UPLOAD_STATUS: {
    context: "check X media upload status",
    refused: "X refused the media status check",
  },
  [X_CREATE_POST_TOOL_SLUG]: {
    context: "publish X post",
    refused: "X refused the post",
  },
};
const X_PUBLISH_TOOL_SLUGS = Object.keys(
  X_PUBLISH_TOOL_STEPS,
) as XPublishToolSlug[];

const MEDIA_PROCESSING_DEFAULT_WAIT_MS = 2_000;
/** X can take up to two minutes to process a video or GIF. */
const MEDIA_PROCESSING_TIMEOUT_MS = 120_000;
// Shared X image cap: 5 MB, under Composio's 5 MiB simple-upload limit.
const X_IMAGE_MAX_BYTES = socialPostMaxBytesForKind("x", "image");

async function prepareXImage(
  media: SocialPostMediaBytes,
): Promise<SocialPostMediaBytes> {
  if (media.bytes.byteLength > X_IMAGE_MAX_BYTES) {
    throw new SocialPostMediaError(
      "media_too_large",
      "The image is larger than X's 5 MB limit. Choose a smaller image and try again.",
    );
  }
  const metadata =
    media.bytes.byteLength > 0
      ? await sharp(media.bytes)
          .metadata()
          .catch(() => null)
      : null;
  if (!metadata || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new SocialPostMediaError(
      "media_type_mismatch",
      "The image could not be read. Attach a JPEG, PNG or WebP image and try again.",
    );
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new SocialPostMediaError(
      "media_type_mismatch",
      "X image uploads need a still image. Attach a still JPEG, PNG or WebP image and try again.",
    );
  }
  let bytes: Buffer;
  let hasTransparency: boolean;
  try {
    hasTransparency =
      metadata.hasAlpha === true &&
      !(await sharp(media.bytes).stats()).isOpaque;
    const image = sharp(media.bytes).autoOrient().toColourspace("srgb");
    // X accepts WebP, but Composio's simple-upload examples only cover JPEG/PNG.
    // Normalize every still format, stripping metadata and unusual encodings.
    if (hasTransparency) {
      bytes = await image.png({ palette: false }).toBuffer();
    } else {
      const jpeg = image.removeAlpha();
      bytes = await jpeg
        .clone()
        .jpeg({ quality: 90, progressive: false })
        .toBuffer();
      for (const quality of [80, 70, 60, 50, 40]) {
        if (bytes.byteLength <= X_IMAGE_MAX_BYTES) break;
        bytes = await jpeg
          .clone()
          .jpeg({ quality, progressive: false })
          .toBuffer();
      }
    }
  } catch {
    throw new SocialPostMediaError(
      "media_type_mismatch",
      "The image could not be converted for X. Attach a JPEG or PNG image and try again.",
    );
  }
  if (bytes.byteLength > X_IMAGE_MAX_BYTES) {
    throw new SocialPostMediaError(
      "media_too_large",
      "The converted image is larger than X's 5 MB limit. Choose a smaller image and try again.",
    );
  }
  const extension = hasTransparency ? "png" : "jpeg";
  return {
    ...media,
    bytes: new Uint8Array(bytes),
    name: `${(media.name || "attachment").replace(/\.[^/.]+$/, "")}.${extension}`,
    mimeType: `image/${extension}`,
  };
}

function mediaCategory(kind: SocialPostMediaKind): string {
  switch (kind) {
    case "image":
      return "tweet_image";
    case "gif":
      return "tweet_gif";
    case "video":
      return "tweet_video";
  }
}

/**
 * X media id from a tool payload. Prefers the string shape: a 17–19 digit id
 * returned as a JSON number would lose precision.
 */
function mediaIdOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.media_id_string, data?.media_id, data?.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return String(candidate);
    }
  }
  return null;
}

function toolErrorMessage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  const detail = value as Record<string, unknown>;
  for (const key of ["message", "detail", "error", "title"]) {
    const candidate = detail[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function processingState(
  data: Record<string, unknown> | null,
): { state: string; waitMs: number; errorMessage: string | null } | null {
  const info =
    typeof data?.processing_info === "object" && data.processing_info !== null
      ? (data.processing_info as Record<string, unknown>)
      : null;
  if (!info || typeof info.state !== "string") return null;
  const checkAfter = info.check_after_secs;
  return {
    state: info.state.toLowerCase(),
    waitMs:
      typeof checkAfter === "number" && checkAfter >= 0
        ? checkAfter * 1000
        : MEDIA_PROCESSING_DEFAULT_WAIT_MS,
    errorMessage: toolErrorMessage(info.error),
  };
}

/** Waits for X to finish processing a media upload, polling within a bounded window. */
async function awaitMediaProcessing(
  sessionId: string,
  mediaId: string,
  uploadResult: Record<string, unknown> | null,
  requiresProcessing: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const step = X_PUBLISH_TOOL_STEPS.TWITTER_GET_MEDIA_UPLOAD_STATUS;
  let processing = processingState(uploadResult);
  if (!processing && requiresProcessing) {
    processing = { state: "pending", waitMs: 0, errorMessage: null };
  }
  const startedAt = Date.now();
  while (processing && processing.state !== "succeeded") {
    if (processing.state === "failed") {
      throw new ComposioToolError({
        message: "X could not process the media",
        providerMessage: processing.errorMessage ?? "Media processing failed",
      });
    }
    const remainingMs = MEDIA_PROCESSING_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new ComposioToolError({
        message: "X media processing timed out",
        providerMessage: "Media processing timed out",
      });
    }
    await delay(
      Math.min(Math.max(processing.waitMs, 1_000), remainingMs),
      undefined,
      { signal },
    );
    signal?.throwIfAborted();
    processing = processingState(
      await executeComposioTool({
        sessionId,
        toolSlug: "TWITTER_GET_MEDIA_UPLOAD_STATUS",
        arguments: { media_id: mediaId },
        context: step.context,
        refused: step.refused,
        signal,
      }),
    );
    if (!processing) {
      throw new ComposioToolError({
        message: "X did not confirm media processing completion",
      });
    }
  }
}

async function uploadXMedia(
  sessionId: string,
  media: SocialPostMediaBytes,
  signal?: AbortSignal,
): Promise<string> {
  const toolSlug =
    media.kind === "image"
      ? "TWITTER_UPLOAD_MEDIA"
      : "TWITTER_UPLOAD_LARGE_MEDIA";
  const step = X_PUBLISH_TOOL_STEPS[toolSlug];
  const name = media.name || "attachment";
  async function stage(tool: XPublishToolSlug): Promise<string> {
    return stageSocialPublishFile({
      toolkitSlug: "twitter",
      toolSlug: tool,
      file: media,
      signal,
    });
  }
  function upload(tool: XPublishToolSlug, s3key: string) {
    signal?.throwIfAborted();
    return executeComposioTool({
      sessionId,
      toolSlug: tool,
      arguments: {
        media: { name, mimetype: media.mimeType, s3key },
        media_category: mediaCategory(media.kind),
        ...(media.kind === "image" ? { media_type: media.mimeType } : {}),
      },
      context: step.context,
      refused: step.refused,
      timeoutMs: tool === "TWITTER_UPLOAD_LARGE_MEDIA" ? 120_000 : 15_000,
      signal,
    });
  }
  const s3key = await stage(toolSlug);
  let result: Record<string, unknown> | null;
  try {
    result = await upload(toolSlug, s3key);
  } catch (error) {
    const status =
      error instanceof ComposioToolError
        ? error.providerStatus
        : error instanceof ComposioApiError
          ? (error.providerStatus ?? error.httpStatus)
          : null;
    if (
      media.kind !== "image" ||
      status === null ||
      status < 400 ||
      status >= 500 ||
      status === 408 ||
      (error instanceof ComposioApiError &&
        (error.httpStatus >= 500 ||
          [401, 408, 429].includes(error.httpStatus))) ||
      classifyPublishError(error, "x").kind !== "rejected"
    )
      throw error;
    signal?.throwIfAborted();
    result = await upload(
      "TWITTER_UPLOAD_LARGE_MEDIA",
      await stage("TWITTER_UPLOAD_LARGE_MEDIA"),
    );
  }
  const mediaId = mediaIdOf(result);
  if (!mediaId)
    throw new ComposioToolError({
      message: "X media upload returned no media id",
    });
  await awaitMediaProcessing(
    sessionId,
    mediaId,
    result,
    media.kind !== "image",
    signal,
  );
  return mediaId;
}

/**
 * Publishes a post to X through a restricted tool-router session pinned to one
 * connected account with only the media-upload and create-post tools enabled.
 * Media bytes are downloaded server-side and uploaded inside the same session;
 * ids never leave this call. The session is deleted once the call settles,
 * whatever the outcome.
 */
export async function publishXPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("x");
  const sessionId = await createComposioToolSession({
    toolkitSlug: "twitter",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs:
      context.media.length > 0
        ? [...X_PUBLISH_TOOL_SLUGS]
        : [X_CREATE_POST_TOOL_SLUG],
    context: "create Project X publish session",
    signal: context.signal,
  });
  try {
    const downloaded =
      context.media.length > 0
        ? await downloadSocialPostMedia("x", context.media, context.signal)
        : [];
    const mediaIds: string[] = [];
    for (const media of downloaded) {
      const prepared =
        media.kind === "image" ? await prepareXImage(media) : media;
      context.signal?.throwIfAborted();
      mediaIds.push(await uploadXMedia(sessionId, prepared, context.signal));
    }
    const createStep = X_PUBLISH_TOOL_STEPS[X_CREATE_POST_TOOL_SLUG];
    const post = await guardSocialCreateOutcome(label, () =>
      executeComposioTool({
        sessionId,
        toolSlug: X_CREATE_POST_TOOL_SLUG,
        arguments: {
          ...(context.text ? { text: context.text } : {}),
          ...(mediaIds.length > 0 ? { media_media_ids: mediaIds } : {}),
          ...(context.replyToExternalId
            ? { reply_in_reply_to_tweet_id: context.replyToExternalId }
            : {}),
          ...(context.quoteExternalId
            ? { quote_tweet_id: context.quoteExternalId }
            : {}),
        },
        context: createStep.context,
        refused: createStep.refused,
        signal: context.signal,
      }),
    );
    if (!post || typeof post.id !== "string" || !post.id) {
      throw new ComposioPublishOutcomeUnknownError(label);
    }
    return {
      externalId: post.id,
      publishedUrl: socialPostPublishedUrl(
        "x",
        context.externalHandle,
        post.id,
      ),
      toolSlug: X_CREATE_POST_TOOL_SLUG,
    };
  } finally {
    await deleteComposioToolSession(
      sessionId,
      "delete Project X publish session",
    );
  }
}
