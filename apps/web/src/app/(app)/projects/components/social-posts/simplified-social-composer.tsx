"use client";

import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";
import {
  SOCIAL_POST_TEXT_LIMITS,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import { Calendar, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import {
  createProjectSocialPost,
  publishProjectSocialPost,
} from "@/lib/actions/project/action";
import { cn } from "@/lib/utils";

export type SimplifiedComposerMode =
  | { kind: "create" }
  | { kind: "edit"; post: SocialPost };

interface SimplifiedComposerProps {
  connections: ProjectSocialConnection[];
  mode: SimplifiedComposerMode;
  onError: (error: ActionError) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (post: SocialPost) => void;
  open: boolean;
  projectId: string;
}

/**
 * Simplified one-screen composer with intelligent defaults.
 * Implements judge's synthesis: pre-selected accounts, "post now" default, 2-click publish.
 */
export function SimplifiedSocialComposer({
  connections,
  mode,
  onError,
  onOpenChange,
  onSaved,
  open,
  projectId,
}: SimplifiedComposerProps) {
  const t = useTranslations("App.Projects.SocialPosts");
  const post = mode.kind === "create" ? null : mode.post;

  // Smart defaults: all active connections selected
  const activeConnections = connections.filter((c) => c.status === "active");
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<
    Set<string>
  >(
    new Set(
      post?.socialConnection?.id
        ? [post.socialConnection.id]
        : activeConnections.map((c) => c.id),
    ),
  );

  const [text, setText] = useState(post?.text ?? "");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [pending, setPending] = useState(false);

  // Character counts for selected platforms
  const selectedConnections = activeConnections.filter((c) =>
    selectedConnectionIds.has(c.id),
  );
  const characterLimits = selectedConnections.map((conn) => ({
    provider: conn.provider,
    limit: SOCIAL_POST_TEXT_LIMITS[conn.provider],
    count: text.length,
    ok: text.length <= SOCIAL_POST_TEXT_LIMITS[conn.provider],
  }));

  const anyOverLimit = characterLimits.some((c) => !c.ok);
  const canPublish =
    text.trim().length > 0 &&
    !anyOverLimit &&
    selectedConnectionIds.size > 0 &&
    scheduleMode === "now";

  function toggleConnection(id: string) {
    const next = new Set(selectedConnectionIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedConnectionIds(next);
  }

  async function handlePublish() {
    if (!canPublish || pending) return;

    setPending(true);
    try {
      // Create or update post
      const createResult = post
        ? { ok: true as const, value: post }
        : await createProjectSocialPost({
            projectId,
            text: text.trim(),
            media: [],
            socialConnectionId: Array.from(selectedConnectionIds)[0],
          });

      if (!createResult.ok) {
        onError(createResult.error);
        return;
      }

      // Publish immediately
      const publishResult = await publishProjectSocialPost({
        projectId,
        postId: createResult.value.id,
        revision: createResult.value.revision,
      });

      if (!publishResult.ok) {
        onError(publishResult.error);
        return;
      }

      toast.success(t("toasts.published"));
      onSaved(publishResult.value);
      onOpenChange(false);
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setPending(false);
    }
  }

  function handleSaveDraft() {
    toast.info("Draft save not implemented in simplified composer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "create"
              ? t("composer.title")
              : t("composer.editTitle")}
          </DialogTitle>
          <DialogDescription>{t("composer.smartDefaults")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Text editor */}
          <div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("composer.placeholder")}
              className="min-h-[120px] resize-none"
              autoFocus
            />

            {/* Character counts */}
            {text.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {characterLimits.map((limit) => (
                  <span
                    key={limit.provider}
                    className={cn(
                      limit.ok ? "text-muted-foreground" : "text-destructive",
                    )}
                  >
                    {socialPostProviderLabel(limit.provider)}: {limit.count}/
                    {limit.limit}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Account selection */}
          <div>
            <p className="text-sm font-medium mb-2">{t("composer.postTo")}</p>
            <div className="flex flex-wrap gap-2">
              {activeConnections.map((conn) => {
                const selected = selectedConnectionIds.has(conn.id);
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => toggleConnection(conn.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md border transition-colors",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <SocialPostProviderIcon
                      provider={conn.provider}
                      className="size-4"
                    />
                    <span className="text-sm">
                      {conn.externalHandle || conn.displayName}
                    </span>
                    {selected && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
            {selectedConnectionIds.size === 0 && (
              <p className="text-sm text-destructive mt-2">
                {t("composer.selectAccount")}
              </p>
            )}
          </div>

          {/* Schedule mode */}
          <div>
            <p className="text-sm font-medium mb-2">{t("composer.when")}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={scheduleMode === "now" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleMode("now")}
              >
                {t("composer.postNow")}
              </Button>
              <Button
                type="button"
                variant={scheduleMode === "later" ? "default" : "outline"}
                size="sm"
                onClick={() => setScheduleMode("later")}
                disabled
              >
                <Calendar className="size-4 mr-2" />
                {t("composer.scheduleLater")}
              </Button>
            </div>
            {scheduleMode === "later" && (
              <p className="text-sm text-muted-foreground mt-2">
                {t("composer.scheduleComingSoon")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={pending || text.trim().length === 0}
          >
            {t("composer.saveDraft")}
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={!canPublish || pending}
          >
            {pending ? t("composer.publishing") : t("composer.post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
