"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function useReportMovedSocialPostQuotes() {
  const t = useTranslations("App.Projects.SocialPosts.toasts");
  return (post: Pick<SocialPost, "movedQuotes">) => {
    const count = post.movedQuotes?.length ?? 0;
    if (count > 0) toast.success(t("movedQuotes", { count }));
  };
}

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
  return reason;
}
