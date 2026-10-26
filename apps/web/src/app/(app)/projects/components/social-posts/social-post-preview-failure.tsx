"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";

import { TimezoneLabel } from "@/components/timezone-label";
import { DEFAULT_TIME_ZONE } from "@/i18n/time-zone";

function failureReason(
  post: SocialPost,
  authorizationRevoked: string,
): string | null {
  return post.lastAttempt?.outcome === "authorization_revoked"
    ? authorizationRevoked
    : post.lastError;
}

/** Why a failed or missed post did not go out, plus when the last try finished. */
export function SocialPostPreviewFailure({ post }: { post: SocialPost }) {
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const reason = failureReason(post, t("outcomes.authorizationRevoked"));
  const failedAt = post.lastAttempt?.finishedAt ?? null;

  if (post.status === "MISSED") {
    return reason ? (
      <p
        className="text-muted-foreground text-sm"
        data-testid="social-post-preview-failure"
      >
        {reason}
      </p>
    ) : null;
  }

  if (
    post.status !== "FAILED" ||
    (!reason && !failedAt && !post.partiallyPublished)
  )
    return null;

  return (
    <div className="space-y-0.5" data-testid="social-post-preview-failure">
      {post.partiallyPublished ? (
        <p className="text-semantic-warning text-sm" role="status">
          {t("thread.progress", {
            published: post.publishedThreadPartCount,
            total: post.threadPartCount,
          })}
          {post.failedThreadPartPosition
            ? ` ${t("thread.failedPart", { part: post.failedThreadPartPosition })}`
            : null}
        </p>
      ) : null}
      {post.publishingThreadPartPosition ? (
        <p className="text-semantic-warning text-sm">
          {t("thread.outcomeUnknown", {
            part: post.publishingThreadPartPosition,
          })}
        </p>
      ) : null}
      {reason ? <p className="text-destructive text-sm">{reason}</p> : null}
      {failedAt ? (
        <time
          className="text-muted-foreground text-xs"
          dateTime={new Date(failedAt).toISOString()}
        >
          {t("failedAt", {
            date: formatter.dateTime(new Date(failedAt), "dateTime"),
          })}{" "}
          · <TimezoneLabel timeZone={timeZone} at={new Date(failedAt)} />
        </time>
      ) : null}
    </div>
  );
}
