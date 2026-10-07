"use client";

import type { SocialPost } from "@sokosumi/core-client";
import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SocialPostComposerMode } from "./social-post-composer-dialog";
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
            className="text-muted-foreground text-sm"
            data-testid="social-post-needs-reconnect"
          >
            {t("needsReconnect")}
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
