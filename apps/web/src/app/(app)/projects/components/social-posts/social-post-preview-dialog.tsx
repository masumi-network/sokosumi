"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refreshProjectSocialPostStatistics } from "@/lib/actions/project/action";
import type { SocialPostComposerMode } from "./social-post-composer-dialog";
import { SocialPostMetrics } from "./social-post-metrics";
import { SocialPostPreview } from "./social-post-preview";

export function SocialPostPreviewDialog({
  post,
  open,
  onOpenChange,
  onCompose,
  actions,
  onCloseAutoFocus,
}: {
  post: SocialPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompose: (mode: SocialPostComposerMode) => void;
  actions?: React.ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const [statisticsPost, setStatisticsPost] = useState<SocialPost | null>(null);
  const [refreshingPostId, setRefreshingPostId] = useState<string | null>(null);
  const [statisticsErrorPostId, setStatisticsErrorPostId] = useState<
    string | null
  >(null);
  const refreshedPost = statisticsPost?.id === post?.id ? statisticsPost : post;

  async function handleRefreshStatistics(target: SocialPost) {
    if (refreshingPostId) return;
    setRefreshingPostId(target.id);
    setStatisticsErrorPostId(null);
    try {
      const result = await refreshProjectSocialPostStatistics({
        projectId: target.projectId,
        postId: target.id,
      });
      if (result.ok) setStatisticsPost(result.value);
      else setStatisticsErrorPostId(target.id);
    } catch {
      setStatisticsErrorPostId(target.id);
    } finally {
      setRefreshingPostId(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("preview.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {post?.scheduledAt
              ? formatter.dateTime(post.scheduledAt, "dateTime")
              : post
                ? t(`status.${post.status}`)
                : null}
          </DialogDescription>
        </DialogHeader>
        {post?.connectionNeedsReconnect ? (
          <p
            className="text-semantic-warning flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
            data-testid="social-post-needs-reconnect"
            role="status"
          >
            <span>{t("needsReconnect")}</span>
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/social?projectId=${encodeURIComponent(post.projectId)}&tab=accounts`}
            >
              {t("needsReconnectLink")}
            </Link>
          </p>
        ) : null}
        {post ? (
          <SocialPostPreview
            account={
              post.socialConnection
                ? {
                    handle: post.socialConnection.externalHandle,
                    displayName: post.socialConnection.displayName,
                    avatarUrl: post.socialConnection.avatarUrl,
                  }
                : null
            }
            className="max-h-[70dvh] overflow-y-auto"
            media={post.media}
            provider={post.provider}
            text={post.text}
            timestamp={post.publishedAt ?? post.scheduledAt}
          />
        ) : null}
        {post?.status === "PUBLISHED" ? (
          <div className="space-y-3">
            <SocialPostMetrics statistics={refreshedPost?.statistics} compact />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={refreshingPostId === post.id}
              disabled={Boolean(refreshingPostId)}
              onClick={() => void handleRefreshStatistics(post)}
            >
              {t("statistics.refresh")}
            </Button>
            {statisticsErrorPostId === post.id ? (
              <p role="alert" className="text-semantic-warning text-sm">
                {t("statistics.refreshFailed")}
              </p>
            ) : null}
          </div>
        ) : null}
        {post ? (
          <DialogFooter className="gap-2 sm:gap-2">
            {actions}
            <>
              {post.canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onCompose({ kind: "edit", post });
                    onOpenChange(false);
                  }}
                >
                  {t("composer.edit")}
                </Button>
              ) : null}
              {post.status === "PUBLISHED" && post.publishedUrl ? (
                <Button type="button" variant="outline" asChild>
                  <a href={post.publishedUrl} rel="noreferrer" target="_blank">
                    {t("viewPost")}
                    <ExternalLink className="size-4" aria-hidden />
                  </a>
                </Button>
              ) : null}
              {post.canSchedule ? (
                <Button
                  type="button"
                  onClick={() => {
                    onCompose({ kind: "schedule", post });
                    onOpenChange(false);
                  }}
                >
                  {post.status === "DRAFT"
                    ? t("composer.schedule")
                    : t("composer.reschedule")}
                </Button>
              ) : null}
            </>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
