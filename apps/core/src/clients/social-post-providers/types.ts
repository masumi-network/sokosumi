import type {
  SocialPostMediaKind,
  SocialPostMediaRef,
  SocialPostProvider,
} from "@sokosumi/utils";

import type { z } from "zod";
import type { tikTokPostSettingsSchema } from "@/schemas/social-post.schema";
export type TikTokPostSettings = z.infer<typeof tikTokPostSettingsSchema>;

/** One publish attempt's provider-independent input. Media stays as refs. */
export interface SocialPostPublishContext {
  /** Persisted Social post ID used for provider idempotency. */
  postId?: string;
  provider: SocialPostProvider;
  connectedAccountId: string;
  executorUserId: string;
  /** Provider identity id stored on the connection (page, person, channel, ...). */
  externalAccountId: string;
  externalHandle: string | null;
  text: string;
  media: readonly SocialPostMediaRef[];
  /** X thread replies target the preceding part's confirmed id. */
  replyToExternalId?: string;
  tikTokSettings?: TikTokPostSettings;
  /** The media shows a generated person (a talking video): label it AI-made where the network can. */
  aiGenerated?: boolean;
  /** The video is vertical and at most 90 seconds: a Reel where the network has them. */
  reel?: boolean;
  quoteExternalId?: string;
  /** For a provider that posts the first comment in the same call as the post. */
  firstComment?: string;
  signal?: AbortSignal;
}

export interface SocialPostPublishResult {
  /** Null when the platform confirmed the post but returned no id for it. */
  externalId: string | null;
  publishedUrl: string | null;
  providerOutcome?: string;
  /** Set when the tool that produced the id differs from the attempt's default. */
  toolSlug?: string;
  /** The provider took the first comment with the post: do not post it again. */
  firstCommentIncluded?: boolean;
}

/** Downloaded Drive bytes handed to adapters that upload files. */
export interface SocialPostMediaBytes {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  mimeType: string;
  kind: SocialPostMediaKind;
}
