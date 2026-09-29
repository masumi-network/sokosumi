import type {
  SocialPostMediaKind,
  SocialPostMediaRef,
  SocialPostProvider,
} from "@sokosumi/utils";

/** One publish attempt's provider-independent input. Media stays as refs. */
export interface SocialPostPublishContext {
  provider: SocialPostProvider;
  connectedAccountId: string;
  executorUserId: string;
  /** Provider identity id stored on the connection (page, person, channel, ...). */
  externalAccountId: string;
  externalHandle: string | null;
  text: string;
  media: readonly SocialPostMediaRef[];
  signal?: AbortSignal;
}

export interface SocialPostPublishResult {
  externalId: string;
  publishedUrl: string | null;
  providerOutcome?: string;
  /** Set when the tool that produced the id differs from the attempt's default. */
  toolSlug?: string;
}

/** Downloaded Drive bytes handed to adapters that upload files. */
export interface SocialPostMediaBytes {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  mimeType: string;
  kind: SocialPostMediaKind;
}
