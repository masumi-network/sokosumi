import {
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import { publishFacebookPost } from "@/clients/social-post-providers/facebook";
import { publishInstagramPost } from "@/clients/social-post-providers/instagram";
import { publishLinkedInPost } from "@/clients/social-post-providers/linkedin";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { publishXPost } from "@/clients/social-post-providers/x";
import { publishYouTubeVideo } from "@/clients/social-post-providers/youtube";

/** Create/publish tool recorded on an attempt before the adapter runs. */
export const SOCIAL_POST_ATTEMPT_TOOL_SLUGS: Record<
  SocialPostProvider,
  string
> = {
  x: "TWITTER_CREATION_OF_A_POST",
  linkedin: "LINKEDIN_CREATE_LINKED_IN_POST",
  facebook: "FACEBOOK_CREATE_POST",
  instagram: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
  tiktok: "TIKTOK_PUBLISH_VIDEO",
  youtube: "YOUTUBE_UPLOAD_VIDEO",
};

export async function publishSocialPostToProvider(
  context: SocialPostPublishContext,
): Promise<SocialPostPublishResult> {
  switch (context.provider) {
    case "x":
      return publishXPost(context);
    case "linkedin":
      return publishLinkedInPost(context);
    case "facebook":
      return publishFacebookPost(context);
    case "instagram":
      return publishInstagramPost(context);
    case "youtube":
      return publishYouTubeVideo(context);
    default:
      throw new ComposioToolError({
        message: `${socialPostProviderLabel(context.provider)} publishing is not available yet`,
      });
  }
}
