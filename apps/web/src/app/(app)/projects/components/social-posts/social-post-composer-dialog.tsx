"use client";

import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  createProjectSocialPost,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import type {
  ProjectSocialConnection,
  SocialPost,
} from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

/** Composer entry points: a new post, editing text/account, or only picking a time. */
export type SocialPostComposerMode =
  | { kind: "create" }
  | { kind: "edit"; post: SocialPost }
  | { kind: "schedule"; post: SocialPost };

interface SocialPostComposerDialogProps {
  connections: ProjectSocialConnection[];
  mode: SocialPostComposerMode;
  onError: (error: ActionError) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (post: SocialPost) => void;
  open: boolean;
  projectId: string;
}

type PendingSubmit = "save" | "schedule" | null;

const DATETIME_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm";

function toDateTimeLocalValue(date: Date | null): string {
  return date ? format(date, DATETIME_LOCAL_FORMAT) : "";
}

function formatHandle(handle: string | null): string {
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function resolveTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function SocialPostComposerDialog({
  connections,
  mode,
  onError,
  onOpenChange,
  onSaved,
  open,
  projectId,
}: SocialPostComposerDialogProps) {
  const t = useTranslations("App.Projects.SocialPosts");
  const textId = useId();
  const accountId = useId();
  const scheduledAtId = useId();
  const post = mode.kind === "create" ? null : mode.post;
  const provider = post?.provider ?? "x";
  const textLimit = SOCIAL_POST_TEXT_LIMITS[provider];

  const [text, setText] = useState(post?.text ?? "");
  const [connectionId, setConnectionId] = useState(
    post?.socialConnection?.id ?? connections[0]?.id ?? "",
  );
  const [scheduledAt, setScheduledAt] = useState(
    toDateTimeLocalValue(post?.scheduledAt ?? null),
  );
  const [pending, setPending] = useState<PendingSubmit>(null);

  const isScheduleOnly = mode.kind === "schedule";
  const isBusy = pending !== null;
  const trimmedText = text.trim();
  const overLimit = text.length > textLimit;
  const textValid = isScheduleOnly || (trimmedText.length > 0 && !overLimit);
  const minScheduledAt = toDateTimeLocalValue(new Date());
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const scheduledInFuture =
    scheduledDate !== null &&
    !Number.isNaN(scheduledDate.getTime()) &&
    scheduledDate.getTime() > Date.now();
  const canSchedule =
    textValid && connectionId !== "" && scheduledInFuture && !isBusy;
  const canSave = textValid && !isBusy;
  const isReschedule = post?.status === "SCHEDULED";
  const selectedConnectionExists = connections.some(
    (connection) => connection.id === connectionId,
  );

  const title =
    mode.kind === "create"
      ? t("composer.newTitle")
      : mode.kind === "edit"
        ? t("composer.editTitle")
        : isReschedule
          ? t("composer.rescheduleTitle")
          : t("composer.scheduleTitle");

  async function handleSaveDraft(): Promise<void> {
    if (!canSave) return;
    setPending("save");
    try {
      const result =
        mode.kind === "edit"
          ? await updateProjectSocialPost({
              projectId,
              postId: mode.post.id,
              text: trimmedText,
              socialConnectionId: connectionId || null,
              revision: mode.post.revision,
            })
          : await createProjectSocialPost({
              projectId,
              text: trimmedText,
              socialConnectionId: connectionId || null,
            });
      if (!result.ok) {
        onError(result.error);
        return;
      }
      toast.success(
        mode.kind === "edit" ? t("toasts.updated") : t("toasts.created"),
      );
      onSaved(result.value);
      onOpenChange(false);
    } finally {
      setPending(null);
    }
  }

  async function handleSchedule(): Promise<void> {
    if (!canSchedule || !scheduledDate) return;
    setPending("schedule");
    const scheduledAtIso = scheduledDate.toISOString();
    const timezone = resolveTimezone();
    try {
      if (mode.kind === "create") {
        const result = await createProjectSocialPost({
          projectId,
          text: trimmedText,
          socialConnectionId: connectionId,
          scheduledAt: scheduledAtIso,
          timezone,
        });
        if (!result.ok) {
          onError(result.error);
          return;
        }
        toast.success(t("toasts.scheduled"));
        onSaved(result.value);
        onOpenChange(false);
        return;
      }

      let revision = mode.post.revision;
      if (mode.kind === "edit" && trimmedText !== mode.post.text) {
        const updated = await updateProjectSocialPost({
          projectId,
          postId: mode.post.id,
          text: trimmedText,
          revision,
        });
        if (!updated.ok) {
          onError(updated.error);
          return;
        }
        revision = updated.value.revision;
      }

      const result = await scheduleProjectSocialPost({
        projectId,
        postId: mode.post.id,
        scheduledAt: scheduledAtIso,
        timezone,
        socialConnectionId: connectionId,
        revision,
      });
      if (!result.ok) {
        onError(result.error);
        return;
      }
      toast.success(t("toasts.scheduled"));
      onSaved(result.value);
      onOpenChange(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isBusy) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("composer.description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          data-testid="social-post-composer"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {isScheduleOnly ? (
            <p className="bg-card-background rounded-md border p-3 text-sm whitespace-pre-wrap">
              {post?.text}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={textId}>{t("composer.text")}</Label>
                <span
                  aria-live="polite"
                  className={cn(
                    "text-xs tabular-nums",
                    overLimit ? "text-destructive" : "text-muted-foreground",
                  )}
                  data-testid="social-post-character-count"
                >
                  {t("composer.characters", {
                    count: text.length,
                    limit: textLimit,
                  })}
                </span>
              </div>
              <Textarea
                id={textId}
                aria-invalid={overLimit || undefined}
                disabled={isBusy}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("composer.textPlaceholder")}
                rows={5}
                value={text}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={accountId}>{t("composer.account")}</Label>
            <Select
              disabled={isBusy || connections.length === 0}
              onValueChange={setConnectionId}
              value={selectedConnectionExists ? connectionId : ""}
            >
              <SelectTrigger id={accountId} className="w-full">
                <SelectValue placeholder={t("composer.noAccount")} />
              </SelectTrigger>
              <SelectContent>
                {connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id}>
                    {formatHandle(connection.externalHandle) ||
                      t("composer.unknownHandle")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={scheduledAtId}>{t("composer.scheduledAt")}</Label>
            <Input
              id={scheduledAtId}
              disabled={isBusy}
              min={minScheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              type="datetime-local"
              value={scheduledAt}
            />
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isBusy}
            onClick={() => onOpenChange(false)}
          >
            {t("composer.close")}
          </Button>
          {isScheduleOnly ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={!canSave}
              onClick={() => {
                void handleSaveDraft();
              }}
            >
              {pending === "save" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {mode.kind === "edit" && mode.post.status !== "DRAFT"
                ? t("composer.save")
                : t("composer.saveDraft")}
            </Button>
          )}
          <Button
            type="button"
            disabled={!canSchedule}
            onClick={() => {
              void handleSchedule();
            }}
          >
            {pending === "schedule" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {isReschedule ? t("composer.reschedule") : t("composer.schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
