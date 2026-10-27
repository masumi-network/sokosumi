/** Includes the main post, which remains on SocialPost. */
export { SOCIAL_POST_THREAD_MAX_PARTS } from "@sokosumi/utils";

interface ThreadProgress {
  publishedExternalId: string | null;
  lastError: string | null;
  publishingThreadPartPosition: number | null;
  threadParts: readonly {
    position: number;
    externalPostId: string | null;
    error: string | null;
  }[];
}

export function summarizeSocialPostThread(post: ThreadProgress) {
  const threadPartCount = post.threadParts.length + 1;
  const publishedThreadPartCount =
    Number(Boolean(post.publishedExternalId)) +
    post.threadParts.filter((part) => part.externalPostId).length;
  return {
    threadPartCount,
    publishedThreadPartCount,
    failedThreadPartPosition:
      post.threadParts.find((part) => part.error && !part.externalPostId)
        ?.position ??
      (post.lastError ? post.publishingThreadPartPosition : null) ??
      (post.threadParts.length > 0 &&
      !post.publishedExternalId &&
      post.lastError
        ? 1
        : null),
    partiallyPublished:
      publishedThreadPartCount > 0 &&
      publishedThreadPartCount < threadPartCount,
  };
}
