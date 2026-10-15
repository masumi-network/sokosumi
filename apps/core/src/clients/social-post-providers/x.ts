import { setTimeout as delay } from "node:timers/promises";
import {
  type SocialPostMediaKind,
  socialPostProviderLabel,
} from "@sokosumi/utils";

import { deleteComposioToolSession } from "@/clients/composio.client";
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
import { downloadSocialPostMedia } from "@/helpers/social-post-media";

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
    refused: "X refused the image upload",
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
  const s3key = await stageSocialPublishFile({
    toolkitSlug: "twitter",
    toolSlug,
    file: media,
    signal,
  });
  const result = await executeComposioTool({
    sessionId,
    toolSlug,
    arguments: {
      media: { name, mimetype: media.mimeType, s3key },
      media_category: mediaCategory(media.kind),
    },
    context: step.context,
    refused: step.refused,
    timeoutMs: toolSlug === "TWITTER_UPLOAD_LARGE_MEDIA" ? 120_000 : 15_000,
    signal,
  });
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
      mediaIds.push(await uploadXMedia(sessionId, media, context.signal));
    }
    const createStep = X_PUBLISH_TOOL_STEPS[X_CREATE_POST_TOOL_SLUG];
    const post = await guardSocialCreateOutcome(label, () =>
      executeComposioTool({
        sessionId,
        toolSlug: X_CREATE_POST_TOOL_SLUG,
        arguments: {
          ...(context.text ? { text: context.text } : {}),
          ...(mediaIds.length > 0 ? { media_media_ids: mediaIds } : {}),
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
