"use client";

import { useTranslations } from "next-intl";

export function SocialPostQuoteBadge({
  quotedPostId,
}: {
  quotedPostId: string | null;
}) {
  const t = useTranslations("App.Projects.SocialPosts.quote");
  return quotedPostId ? (
    <span
      className="text-muted-foreground inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-2xs font-medium"
      data-testid="social-post-quote-badge"
    >
      {t("label")}
    </span>
  ) : null;
}

export function socialPostQuoteAttentionCopy(
  reason: string,
  t: (key: string) => string,
): string {
  if (reason === "The post it quotes failed to publish")
    return t("quote.failed");
  if (reason === "The quoted post was cancelled") return t("quote.cancelled");
  if (
    reason ===
    "The quoted post did not publish within 30 minutes of this post's scheduled time. Retry after it publishes, pick another post, or remove the quote."
  )
    return t("quote.waitExpired");
  return reason;
}
