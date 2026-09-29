import { socialPostProviderLabel } from "@sokosumi/utils";

import { deleteProjectSocialSession } from "@/clients/composio.client";
import { socialPostPublishedUrl } from "@/clients/social-post-providers/published-url";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  createSocialPublishSession,
  executeSocialPublishTool,
  guardSocialCreateOutcome,
  stageSocialPublishFile,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { downloadSocialPostMedia } from "@/helpers/social-post-media";

const YOUTUBE_UPLOAD_TOOL_SLUG = "YOUTUBE_UPLOAD_VIDEO";
/** People & Blogs; YouTube requires a category id. */
const YOUTUBE_DEFAULT_CATEGORY_ID = "22";
const YOUTUBE_TITLE_LIMIT = 100;

/** First non-empty line, trimmed and capped at YouTube's title limit. */
export function deriveYouTubeTitle(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return (line ?? "Untitled").slice(0, YOUTUBE_TITLE_LIMIT);
}

function videoIdOf(data: Record<string, unknown> | null): string | null {
  const candidates = [data?.id, data?.videoId, data?.video_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

/**
 * Uploads the single attached video through a staged file and publishes it
 * public with metadata derived from the post text.
 */
export async function publishYouTubeVideo(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  const label = socialPostProviderLabel("youtube");
  const sessionId = await createSocialPublishSession({
    toolkitSlug: "youtube",
    connectedAccountId: context.connectedAccountId,
    executorUserId: context.executorUserId,
    toolSlugs: [YOUTUBE_UPLOAD_TOOL_SLUG],
    context: "create Project YouTube publish session",
    signal: context.signal,
  });
  try {
    const downloaded = await downloadSocialPostMedia(
      "youtube",
      context.media,
      context.signal,
    );
    const video = downloaded[0];
    if (!video) {
      throw new ComposioToolError({ message: "YouTube requires a video" });
    }
    const s3key = await stageSocialPublishFile({
      toolkitSlug: "youtube",
      toolSlug: YOUTUBE_UPLOAD_TOOL_SLUG,
      file: video,
      signal: context.signal,
    });
    const uploaded = await guardSocialCreateOutcome(label, () =>
      executeSocialPublishTool({
        sessionId,
        toolSlug: YOUTUBE_UPLOAD_TOOL_SLUG,
        arguments: {
          title: deriveYouTubeTitle(context.text),
          description: context.text,
          tags: [],
          categoryId: YOUTUBE_DEFAULT_CATEGORY_ID,
          privacyStatus: "public",
          videoFilePath: {
            name: video.name,
            mimetype: video.mimeType,
            s3key,
          },
        },
        context: "upload YouTube video",
        refused: "YouTube refused the upload",
        timeoutMs: 180_000,
        signal: context.signal,
      }),
    );
    const externalId = videoIdOf(uploaded);
    if (!externalId) throw new ComposioPublishOutcomeUnknownError(label);
    return {
      externalId,
      publishedUrl: socialPostPublishedUrl(
        "youtube",
        context.externalHandle,
        externalId,
      ),
      providerOutcome: "public",
      toolSlug: YOUTUBE_UPLOAD_TOOL_SLUG,
    };
  } finally {
    await deleteProjectSocialSession(
      sessionId,
      "delete Project YouTube publish session",
    );
  }
}
