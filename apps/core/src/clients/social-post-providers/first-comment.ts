import {
  type SocialPostProvider,
  socialPostFirstCommentLimit,
  socialPostProviderLabel,
  socialPostTextLength,
} from "@sokosumi/utils";

import { deleteComposioToolSession } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";

const FIRST_COMMENT_TOOLS = {
  x: {
    toolkitSlug: "twitter",
    toolSlug: "TWITTER_CREATION_OF_A_POST",
  },
  linkedin: {
    toolkitSlug: "linkedin",
    toolSlug: "LINKEDIN_CREATE_COMMENT_ON_POST",
  },
  facebook: {
    toolkitSlug: "facebook",
    toolSlug: "FACEBOOK_CREATE_COMMENT",
  },
  instagram: {
    toolkitSlug: "instagram",
    toolSlug: "INSTAGRAM_POST_IG_MEDIA_COMMENTS",
  },
  youtube: {
    toolkitSlug: "youtube",
    toolSlug: "YOUTUBE_POST_COMMENT",
  },
} as const satisfies Partial<
  Record<SocialPostProvider, { toolkitSlug: string; toolSlug: string }>
>;

export interface PublishSocialPostFirstCommentInput {
  provider: SocialPostProvider;
  connectedAccountId: string;
  executorUserId: string;
  externalAccountId: string;
  externalId: string;
  text: string;
  subscriptionType?: string | null;
  signal?: AbortSignal;
}

function linkedInCommentUrn(externalId: string): string | null {
  if (
    externalId.startsWith("urn:li:share:") ||
    externalId.startsWith("urn:li:ugcPost:")
  ) {
    return externalId;
  }
  if (externalId.startsWith("urn:li:")) return null;
  return `urn:li:share:${externalId}`;
}

function commentArguments(
  input: PublishSocialPostFirstCommentInput,
): Record<string, unknown> | null {
  switch (input.provider) {
    case "x":
      return {
        text: input.text,
        reply_in_reply_to_tweet_id: input.externalId,
      };
    case "linkedin": {
      const urn = linkedInCommentUrn(input.externalId);
      if (!urn) return null;
      return {
        actor: `urn:li:person:${input.externalAccountId}`,
        object: urn,
        target_urn: urn,
        message: { text: input.text },
      };
    }
    case "facebook":
      return { message: input.text, object_id: input.externalId };
    case "instagram":
      return { message: input.text, ig_media_id: input.externalId };
    case "youtube":
      return {
        videoId: input.externalId,
        channelId: input.externalAccountId,
        textOriginal: input.text,
      };
    case "tiktok":
      return null;
  }
}

/** Comment tool for a provider, or `null` when Composio cannot post one. */
export function socialPostFirstCommentTool(
  provider: SocialPostProvider,
): { toolkitSlug: string; toolSlug: string } | null {
  if (provider === "tiktok") return null;
  return FIRST_COMMENT_TOOLS[provider];
}

/**
 * Posts the stored first comment after the post exists. Callers must not treat
 * a refusal here as an unpublished post.
 */
export async function publishSocialPostFirstComment(
  input: PublishSocialPostFirstCommentInput,
): Promise<void> {
  const tool = socialPostFirstCommentTool(input.provider);
  const limit = socialPostFirstCommentLimit(
    input.provider,
    input.subscriptionType,
  );
  const text = input.text.trim();
  if (
    !tool ||
    limit === null ||
    text.length === 0 ||
    socialPostTextLength(input.provider, text) > limit
  ) {
    return;
  }
  const args = commentArguments({ ...input, text });
  if (!args) return;

  const label = socialPostProviderLabel(input.provider);
  const sessionId = await createComposioToolSession({
    toolkitSlug: tool.toolkitSlug,
    connectedAccountId: input.connectedAccountId,
    executorUserId: input.executorUserId,
    toolSlugs: [tool.toolSlug],
    context: `create Project ${label} first-comment session`,
    signal: input.signal,
  });
  try {
    await executeComposioTool({
      sessionId,
      toolSlug: tool.toolSlug,
      arguments: args,
      context: `publish ${label} first comment`,
      refused: `${label} refused the first comment`,
      signal: input.signal,
    });
  } finally {
    await deleteComposioToolSession(
      sessionId,
      `delete Project ${label} first-comment session`,
    );
  }
}
