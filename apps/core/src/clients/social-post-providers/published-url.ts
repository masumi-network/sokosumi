import type { SocialPostProvider } from "@sokosumi/utils";

/**
 * Best-effort public URL for a published post. Providers that do not return a
 * stable link from their create/publish response resolve to `null`; adapters
 * may override with a permalink the provider returned.
 */
export function socialPostPublishedUrl(
  provider: SocialPostProvider,
  externalHandle: string | null,
  externalId: string,
): string | null {
  switch (provider) {
    case "x":
      return externalHandle
        ? `https://x.com/${encodeURIComponent(externalHandle)}/status/${externalId}`
        : `https://x.com/i/web/status/${externalId}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/${externalId}`;
    case "facebook":
      return `https://www.facebook.com/${externalId}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${externalId}`;
    case "instagram":
    case "tiktok":
      return null;
  }
}
