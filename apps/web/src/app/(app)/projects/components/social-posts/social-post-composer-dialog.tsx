"use client";

import {
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostMediaValidationReason,
  validateSocialPostMedia,
} from "@sokosumi/utils";
import { format } from "date-fns";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { DriveFilePicker } from "@/components/drive/drive-file-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
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
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import {
  createProjectSocialPost,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import type {
  DriveFile,
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
} from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import {
  buildSocialPostMediaRef,
  hasSocialPostMedia,
  sameSocialPostMedia,
  socialPostMediaRefFromDriveFile,
} from "./social-post-media";

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
const DATETIME_LOCAL_STEP_MS = 60 * 1000;

const DRIVE_PICKER_ACCEPT = [
  ...SOCIAL_POST_MEDIA_RULES.x.imageMimeTypes,
  ...SOCIAL_POST_MEDIA_RULES.x.gifMimeTypes,
  ...SOCIAL_POST_MEDIA_RULES.x.videoMimeTypes,
].join(",");

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
  const scheduledAtErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInFlightRef = useRef(false);
  const post = mode.kind === "create" ? null : mode.post;
  const provider = post?.provider ?? "x";
  const textLimit = SOCIAL_POST_TEXT_LIMITS[provider];
  const { data: session } = useSession();
  const driveStore = driveStoreForActiveWorkspace(
    session?.session.activeOrganizationId ?? null,
  );

  const [text, setText] = useState(post?.text ?? "");
  const [media, setMedia] = useState<SocialPostMediaRef[]>(
    post?.media ? [...post.media] : [],
  );
  const [connectionId, setConnectionId] = useState(
    post?.socialConnection?.id ?? connections[0]?.id ?? "",
  );
  const [scheduledAt, setScheduledAt] = useState(
    toDateTimeLocalValue(post?.scheduledAt ?? null),
  );
  const [pending, setPending] = useState<PendingSubmit>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isScheduleOnly = mode.kind === "schedule";
  const isBusy = pending !== null || uploadPending;
  const trimmedText = text.trim();
  const overLimit = text.length > textLimit;
  const mediaValid = validateSocialPostMedia(provider, media).ok;
  const textValid =
    isScheduleOnly ||
    ((trimmedText.length > 0 || media.length > 0) && !overLimit);
  const earliestScheduledAt = Date.now() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS;
  const minScheduledAt = toDateTimeLocalValue(
    new Date(
      Math.floor(earliestScheduledAt / DATETIME_LOCAL_STEP_MS) *
        DATETIME_LOCAL_STEP_MS +
        DATETIME_LOCAL_STEP_MS,
    ),
  );
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const scheduledAtTooSoon =
    scheduledDate !== null &&
    !Number.isNaN(scheduledDate.getTime()) &&
    scheduledDate.getTime() <= earliestScheduledAt;
  const scheduledAtValid =
    scheduledDate !== null &&
    !Number.isNaN(scheduledDate.getTime()) &&
    !scheduledAtTooSoon;
  const canSchedule =
    textValid &&
    mediaValid &&
    connectionId !== "" &&
    scheduledAtValid &&
    !isBusy;
  const canSave = textValid && mediaValid && !isBusy;
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

  function mediaErrorText(reason: SocialPostMediaValidationReason): string {
    return t(`composer.media.errors.${reason}`);
  }

  function attachMedia(ref: SocialPostMediaRef): void {
    if (hasSocialPostMedia(media, ref.pathname)) {
      toast.error(t("composer.media.alreadyAttached"));
      return;
    }
    const check = validateSocialPostMedia(provider, [...media, ref]);
    if (!check.ok) {
      toast.error(mediaErrorText(check.reason));
      return;
    }
    setMedia((current) => [...current, ref]);
  }

  function handleSelectDriveFile(file: DriveFile): void {
    const ref = socialPostMediaRefFromDriveFile(file);
    if (!ref) {
      toast.error(t("composer.media.unsupported"));
      return;
    }
    attachMedia(ref);
  }

  function handleRemoveMedia(pathname: string): void {
    setMedia((current) => current.filter((ref) => ref.pathname !== pathname));
  }

  async function handleUpload(file: File): Promise<void> {
    if (isBusy || uploadInFlightRef.current) return;
    const candidate = buildSocialPostMediaRef({
      name: file.name,
      size: file.size,
      pathname: "",
      fileUrl: "",
    });
    if (!candidate) {
      toast.error(t("composer.media.unsupported"));
      return;
    }
    const precheck = validateSocialPostMedia(provider, [...media, candidate]);
    if (!precheck.ok) {
      toast.error(mediaErrorText(precheck.reason));
      return;
    }

    uploadInFlightRef.current = true;
    setUploadPending(true);
    try {
      const uploaded = await uploadDriveFile(file, driveStore);
      const ref = buildSocialPostMediaRef({
        name: file.name,
        size: file.size,
        pathname: uploaded.pathname,
        fileUrl: uploaded.fileUrl ?? "",
      });
      if (!ref || !uploaded.fileUrl) {
        toast.error(t("composer.media.uploadFailed"));
        return;
      }
      setMedia((current) => [...current, ref]);
    } catch (error) {
      toast.error(
        isDriveFileUploadDuplicate(error)
          ? t("composer.media.uploadDuplicate")
          : t("composer.media.uploadFailed"),
      );
    } finally {
      uploadInFlightRef.current = false;
      setUploadPending(false);
    }
  }

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
              media,
              socialConnectionId: connectionId || null,
              revision: mode.post.revision,
            })
          : await createProjectSocialPost({
              projectId,
              text: trimmedText,
              media,
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
    } catch (error) {
      onError(toActionRejectionError(error));
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
          media,
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
      const contentChanged =
        trimmedText !== mode.post.text ||
        !sameSocialPostMedia(media, mode.post.media);
      if (mode.kind === "edit" && contentChanged) {
        const updated = await updateProjectSocialPost({
          projectId,
          postId: mode.post.id,
          text: trimmedText,
          media,
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
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setPending(null);
    }
  }

  const mediaStrip = (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="social-post-media"
    >
      {media.map((ref) => (
        <FileChipMiniPreview
          key={ref.pathname}
          fileName={ref.name}
          mediaType={ref.mimeType}
          onRemove={
            isScheduleOnly || isBusy
              ? undefined
              : () => handleRemoveMedia(ref.pathname)
          }
          removeLabel={t("composer.media.remove", { name: ref.name })}
          size={ref.size}
          sizeClass="size-16"
          url={ref.fileUrl}
        />
      ))}
    </div>
  );

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
            <div className="space-y-3">
              <p className="bg-card-background rounded-md border p-3 text-sm whitespace-pre-wrap">
                {post?.text}
              </p>
              {media.length > 0 ? mediaStrip : null}
            </div>
          ) : (
            <>
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

              <div className="space-y-2">
                {media.length > 0 ? mediaStrip : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => setPickerOpen(true)}
                  >
                    <ImagePlus className="size-4" aria-hidden />
                    {t("composer.media.addFromDrive")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="size-4" aria-hidden />
                    )}
                    {uploadPending
                      ? t("composer.media.uploading")
                      : t("composer.media.upload")}
                  </Button>
                  <input
                    ref={fileInputRef}
                    accept={DRIVE_PICKER_ACCEPT}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void handleUpload(file);
                      }
                    }}
                    type="file"
                  />
                  <span className="text-muted-foreground text-xs">
                    {t("composer.media.hint")}
                  </span>
                </div>
              </div>
            </>
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
              aria-describedby={
                scheduledAtTooSoon ? scheduledAtErrorId : undefined
              }
              aria-invalid={scheduledAtTooSoon || undefined}
              disabled={isBusy}
              min={minScheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              type="datetime-local"
              value={scheduledAt}
            />
            {scheduledAtTooSoon ? (
              <p id={scheduledAtErrorId} className="text-destructive text-sm">
                {t("composer.scheduledAtTooSoon")}
              </p>
            ) : null}
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

        <DriveFilePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleSelectDriveFile}
        />
      </DialogContent>
    </Dialog>
  );
}
