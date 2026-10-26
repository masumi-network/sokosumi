import { ssrfSafeFetch } from "@sokosumi/net";
import { socialPostProviderLabel } from "@sokosumi/utils";

import {
  ComposioApiError,
  deleteComposioToolSession,
  record,
} from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioToolError,
  createComposioToolSession,
  executeComposioTool,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostMediaBytes,
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { linkedInPersonUrn } from "@/helpers/linkedin-person";
import { downloadSocialPostMedia } from "@/helpers/social-post-media";

const LINKEDIN_CREATE_POST_TOOL_SLUG = "LINKEDIN_CREATE_LINKED_IN_POST";
const LINKEDIN_REGISTER_IMAGE_TOOL_SLUG = "LINKEDIN_REGISTER_IMAGE_UPLOAD";
const LINKEDIN_UPLOAD_VIDEO_TOOL_SLUG = "LINKEDIN_UPLOAD_VIDEO";
const LINKEDIN_CREATE_VIDEO_TOOL_SLUG = "LINKEDIN_CREATE_VIDEO_POST";

const LINKEDIN_TOOL_SLUGS = [
  LINKEDIN_REGISTER_IMAGE_TOOL_SLUG,
  LINKEDIN_CREATE_POST_TOOL_SLUG,
  LINKEDIN_UPLOAD_VIDEO_TOOL_SLUG,
  LINKEDIN_CREATE_VIDEO_TOOL_SLUG,
];

// A hashtag token stays intact; any other little-text reserved character is escaped.
const LINKEDIN_LITTLE_TEXT = /#[\p{L}\p{N}_]+|[|{}@[\]()<>#\\*_~]/gu;

/**
 * Escapes post commentary for LinkedIn's little text format, which otherwise
 * truncates the post at the first unescaped reserved character. Hashtags keep
 * working; `@` is always escaped because we send no mention elements.
 * https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
 */
export function escapeLinkedInCommentary(text: string): string {
  return text.replace(LINKEDIN_LITTLE_TEXT, (match) =>
    match.length > 1 ? match : `\\${match}`,
  );
}

/** Keys whose value is the created post's URN. */
const LINKEDIN_POST_ID_KEYS = [
  "x-restli-id",
  "X-RestLi-Id",
  "X-Restli-Id",
  "restli_id",
  "id",
  "urn",
  "post_urn",
  "postUrn",
  "post_id",
  "ugcPost",
  "ugc_post_urn",
  "activity",
  "activity_urn",
];
/** Keys whose value is a share URN or a bare numeric share id. */
const LINKEDIN_SHARE_ID_KEYS = ["share_id", "shareUrn", "share_urn"];
const LINKEDIN_NESTED_KEYS = [
  "headers",
  "response_headers",
  "response_data",
  "data",
  "response_dict",
];
const LINKEDIN_POST_URN = /^urn:li:(?:share|ugcPost):[0-9]+$/;
const LINKEDIN_ACTIVITY_URN = /^urn:li:activity:[0-9]+$/;
const LINKEDIN_SCAN_DEPTH = 5;

function linkedInUrnValue(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return LINKEDIN_POST_URN.test(trimmed) || LINKEDIN_ACTIVITY_URN.test(trimmed)
    ? trimmed
    : null;
}

function knownLinkedInPostId(value: unknown, depth: number): string | null {
  const data = record(value);
  if (!data || depth > LINKEDIN_SCAN_DEPTH) return null;
  for (const key of LINKEDIN_POST_ID_KEYS) {
    const urn = linkedInUrnValue(data[key]);
    if (urn) return urn;
  }
  for (const key of LINKEDIN_SHARE_ID_KEYS) {
    const candidate = data[key];
    const urn = linkedInUrnValue(candidate);
    if (urn) return urn;
    if (typeof candidate === "string" && /^[0-9]+$/.test(candidate.trim())) {
      return `urn:li:share:${candidate.trim()}`;
    }
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return `urn:li:share:${candidate}`;
    }
  }
  for (const key of LINKEDIN_NESTED_KEYS) {
    const nested = knownLinkedInPostId(data[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function scanLinkedInUrn(
  value: unknown,
  pattern: RegExp,
  depth: number,
): string | null {
  if (typeof value === "string") {
    if (pattern.test(value.trim())) return value.trim();
    // A nested JSON string is scanned as an object.
    if (!value.trimStart().startsWith("{")) return null;
  }
  if (depth > LINKEDIN_SCAN_DEPTH) return null;
  const values = Array.isArray(value)
    ? value
    : Object.values(record(value) ?? {});
  for (const item of values) {
    const found = scanLinkedInUrn(item, pattern, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Post URN from a LinkedIn create response. LinkedIn returns it only in the
 * `x-restli-id` header, and Composio's wrapping of that varies, so known keys
 * are checked first and any post or activity URN in the payload is the fallback.
 */
export function linkedInPostIdOf(data: unknown): string | null {
  return (
    knownLinkedInPostId(data, 0) ??
    scanLinkedInUrn(data, LINKEDIN_POST_URN, 0) ??
    scanLinkedInUrn(data, LINKEDIN_ACTIVITY_URN, 0)
  );
}

/** Key paths (never values) of a response, to learn its shape from logs. */
export function linkedInResponseKeyPaths(
  value: unknown,
  prefix = "",
  depth = 0,
): string[] {
  const data = record(value);
  if (!data || depth > LINKEDIN_SCAN_DEPTH) return [];
  return Object.entries(data).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...linkedInResponseKeyPaths(nested, path, depth + 1)];
  });
}

function urnOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.asset_urn, data?.video_urn, data?.urn, data?.id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

async function registerLinkedInImage(input: {
  sessionId: string;
  ownerUrn: string;
  file: SocialPostMediaBytes;
  signal?: AbortSignal;
}): Promise<string> {
  const registered = await executeComposioTool({
    sessionId: input.sessionId,
    toolSlug: LINKEDIN_REGISTER_IMAGE_TOOL_SLUG,
    arguments: { owner_urn: input.ownerUrn },
    context: "register LinkedIn image",
    refused: "LinkedIn refused the image upload",
    signal: input.signal,
  });
  const uploadUrl =
    typeof registered?.upload_url === "string" ? registered.upload_url : null;
  const assetUrn = urnOf(registered);
  if (!uploadUrl || !assetUrn) {
    throw new ComposioToolError({
      message: "LinkedIn image upload returned no asset",
    });
  }
  const uploaded = await ssrfSafeFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": input.file.mimeType },
    body: input.file.bytes,
    maxResponseBytes: 64 * 1024,
    signal: input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!uploaded.ok) {
    throw new ComposioApiError(
      uploaded.status,
      undefined,
      "Could not upload LinkedIn image",
    );
  }
  return assetUrn;
}

/**
 * Publishes a LinkedIn post through a restricted tool-router session pinned to
 * the connected person. Images are registered and uploaded as assets; a video
 * is handed to LinkedIn by its public Drive URL. Text-only posts are supported.
 */
export async function publishLinkedInPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("linkedin");
  const sessionId = await createComposioToolSession({
    toolkitSlug: "linkedin",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: LINKEDIN_TOOL_SLUGS,
    context: "create Project LinkedIn publish session",
    signal: context.signal,
  });
  const author = linkedInPersonUrn(context.externalAccountId);
  try {
    const video = context.media.find((ref) => ref.kind === "video");
    let response: Record<string, unknown> | null;
    let toolSlug = LINKEDIN_CREATE_POST_TOOL_SLUG;

    if (video) {
      const uploaded = await executeComposioTool({
        sessionId,
        toolSlug: LINKEDIN_UPLOAD_VIDEO_TOOL_SLUG,
        arguments: { video_url: video.fileUrl },
        context: "upload LinkedIn video",
        refused: "LinkedIn refused the video upload",
        timeoutMs: 120_000,
        signal: context.signal,
      });
      const videoUrn = urnOf(uploaded);
      if (!videoUrn) {
        throw new ComposioToolError({
          message: "LinkedIn video upload returned no video",
        });
      }
      toolSlug = LINKEDIN_CREATE_VIDEO_TOOL_SLUG;
      response = await guardSocialCreateOutcome(label, () =>
        executeComposioTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_VIDEO_TOOL_SLUG,
          arguments: {
            video_urn: videoUrn,
            commentary: escapeLinkedInCommentary(context.text),
            visibility: "PUBLIC",
          },
          context: "publish LinkedIn video post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
    } else if (context.media.length > 0) {
      const downloaded = await downloadSocialPostMedia(
        "linkedin",
        context.media,
        context.signal,
      );
      const assetUrns: string[] = [];
      for (const file of downloaded) {
        assetUrns.push(
          await registerLinkedInImage({
            sessionId,
            ownerUrn: author,
            file,
            signal: context.signal,
          }),
        );
      }
      response = await guardSocialCreateOutcome(label, () =>
        executeComposioTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_POST_TOOL_SLUG,
          arguments: {
            author,
            commentary: escapeLinkedInCommentary(context.text),
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
            images: assetUrns,
          },
          context: "publish LinkedIn post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
    } else {
      response = await guardSocialCreateOutcome(label, () =>
        executeComposioTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_POST_TOOL_SLUG,
          arguments: {
            author,
            commentary: escapeLinkedInCommentary(context.text),
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
          },
          context: "publish LinkedIn post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
    }

    const externalId = linkedInPostIdOf(response);
    if (!externalId) {
      // The create call succeeded, so the post is live; only its id is missing.
      console.warn("[linkedin] Published post returned no post id", {
        toolSlug,
        keyPaths: linkedInResponseKeyPaths(response).slice(0, 100),
      });
    }
    return {
      externalId,
      publishedUrl: externalId
        ? socialPostPublishedUrl("linkedin", context.externalHandle, externalId)
        : null,
      toolSlug,
    };
  } finally {
    await deleteComposioToolSession(
      sessionId,
      "delete Project LinkedIn publish session",
    );
  }
}
