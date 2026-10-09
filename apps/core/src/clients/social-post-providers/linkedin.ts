import { ssrfSafeFetch } from "@sokosumi/net";
import { socialPostProviderLabel } from "@sokosumi/utils";

import {
  ComposioApiError,
  deleteProjectSocialSession,
} from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  createSocialPostToolSession,
  executeSocialPostTool,
  guardSocialCreateOutcome,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostMediaBytes,
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
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

/** Post/share URN from a LinkedIn create response. */
function externalIdOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.id, data?.urn, data?.post_urn, data?.share_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
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
  const registered = await executeSocialPostTool({
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

/** Wrap create-post transport failures: the post may exist even without a response. */

/**
 * Publishes a LinkedIn post through a restricted tool-router session pinned to
 * the connected person. Images are registered and uploaded as assets; a video
 * is handed to LinkedIn by its public Drive URL. Text-only posts are supported.
 */
export async function publishLinkedInPost(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("linkedin");
  const sessionId = await createSocialPostToolSession({
    toolkitSlug: "linkedin",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: LINKEDIN_TOOL_SLUGS,
    context: "create Project LinkedIn publish session",
    signal: context.signal,
  });
  const author = `urn:li:person:${context.externalAccountId}`;
  try {
    const video = context.media.find((ref) => ref.kind === "video");
    let externalId: string | null = null;
    let toolSlug = LINKEDIN_CREATE_POST_TOOL_SLUG;

    if (video) {
      const uploaded = await executeSocialPostTool({
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
      const post = await guardSocialCreateOutcome(label, () =>
        executeSocialPostTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_VIDEO_TOOL_SLUG,
          arguments: {
            video_urn: videoUrn,
            commentary: context.text,
            visibility: "PUBLIC",
          },
          context: "publish LinkedIn video post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
      externalId = externalIdOf(post);
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
      const post = await guardSocialCreateOutcome(label, () =>
        executeSocialPostTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_POST_TOOL_SLUG,
          arguments: {
            author,
            commentary: context.text,
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
            images: assetUrns,
          },
          context: "publish LinkedIn post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
      externalId = externalIdOf(post);
    } else {
      const post = await guardSocialCreateOutcome(label, () =>
        executeSocialPostTool({
          sessionId,
          toolSlug: LINKEDIN_CREATE_POST_TOOL_SLUG,
          arguments: {
            author,
            commentary: context.text,
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
          },
          context: "publish LinkedIn post",
          refused: "LinkedIn refused the post",
          signal: context.signal,
        }),
      );
      externalId = externalIdOf(post);
    }

    if (!externalId) throw new ComposioPublishOutcomeUnknownError(label);
    return {
      externalId,
      publishedUrl: socialPostPublishedUrl(
        "linkedin",
        context.externalHandle,
        externalId,
      ),
      toolSlug,
    };
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      "delete Project LinkedIn publish session",
    );
  }
}
