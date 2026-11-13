"use client";

import type { WorkspaceSocialPost } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

import { publishFailureCopy } from "@/app/projects/components/social-posts/social-post-publish-failure";
import { socialPostQuoteAttentionCopy } from "@/app/projects/components/social-posts/social-post-quote";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSocialProviderAvailability } from "@/contexts/social-provider-availability-context";

import { useSocialCalendarPreview } from "./social-calendar-preview";

/**
 * Needs attention across every project: failed, missed and waiting-for-approval
 * posts, each with its project. Retry and Review open the same post dialog the
 * calendar opens, so every action and its checks stay in one place.
 */
export function SocialAllProjectsAttention({
  items,
  hasMore,
}: {
  items: WorkspaceSocialPost[];
  hasMore: boolean;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const tSocial = useTranslations("App.Social.attentionAll");
  const formatter = useFormatter();
  const { enabledProviders, isProviderEnabled } =
    useSocialProviderAvailability();
  const openPreview = useSocialCalendarPreview();

  if (items.length === 0) {
    return (
      <p
        className="text-muted-foreground py-6 text-sm"
        data-testid="social-all-attention-empty"
      >
        {tSocial("empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul
        aria-label={tSocial("label")}
        className="space-y-2"
        data-testid="social-all-attention"
      >
        {items.map(({ post, projectName }) => {
          const approval = post.status === "NEEDS_APPROVAL";
          const reason = post.needsAttentionReason
            ? socialPostQuoteAttentionCopy(post.needsAttentionReason, t)
            : approval
              ? tSocial("waitingApproval")
              : publishFailureCopy(
                  post,
                  t,
                  (values) => formatter.list(values, { type: "conjunction" }),
                  enabledProviders,
                );
          const at =
            post.lastAttempt?.finishedAt ??
            post.lastAttemptAt ??
            post.scheduledAt;
          const retry =
            !approval && post.canPublishNow && isProviderEnabled(post.provider);
          const label = approval
            ? tSocial("review")
            : retry
              ? t("actions.retry")
              : tSocial("open");
          return (
            <li
              className="bg-background border-border flex flex-wrap items-start gap-3 rounded-lg border p-3"
              data-testid={`social-all-attention-${post.id}`}
              key={post.id}
            >
              <div className="min-w-48 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge className="max-w-48 truncate" variant="secondary">
                    {projectName}
                  </Badge>
                  <SocialPostStatusBadge
                    label={t(`status.${post.status}`)}
                    status={post.status}
                  />
                  {at ? (
                    <time
                      className="text-muted-foreground tabular-nums"
                      dateTime={at.toISOString()}
                    >
                      {formatter.dateTime(at, "dateTime")}
                    </time>
                  ) : null}
                </p>
                <p className="line-clamp-2 text-sm break-words">
                  {post.text || t("thisDraft")}
                </p>
                <p
                  className={
                    post.status === "FAILED"
                      ? "text-destructive text-xs"
                      : "text-muted-foreground text-xs"
                  }
                >
                  {reason}
                </p>
              </div>
              <Button
                aria-label={tSocial("actionFor", {
                  action: label,
                  project: projectName,
                })}
                disabled={!openPreview}
                onClick={(event) =>
                  openPreview?.(post.projectId, post.id, event.currentTarget)
                }
                size="sm"
                type="button"
                variant="outline"
              >
                {label}
              </Button>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <p className="text-muted-foreground text-xs">
          {tSocial("more", { count: items.length })}
        </p>
      ) : null}
    </div>
  );
}
