"use client";

import type {
  DriveFile,
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import {
  SOCIAL_POST_MEDIA_RULES,
  SOCIAL_POST_MIN_SCHEDULE_LEAD_MS,
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostMediaValidationReason,
  socialPostProviderLabel,
  validateSocialPostMedia,
} from "@sokosumi/utils";
import { Calendar, Check, ImagePlus, Upload, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { DriveFilePicker } from "@/components/drive/drive-file-picker";
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
import { FileChipMiniPreview } from "@/components/ui/file-chip-mini-preview";
import { Textarea } from "@/components/ui/textarea";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import {
  createProjectSocialPost,
  publishProjectSocialPost,
} from "@/lib/actions/project/action";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import {
  socialPostComposerAccept,
  socialPostComposerIssue,
  socialPostComposerProviders,
} from "./social-post-composer-rules";
import {
  buildSocialPostMediaRef,
  hasSocialPostMedia,
  socialPostMediaRefFromDriveFile,
} from "./social-post-media";
import {
  SocialPostSchedulePicker,
  toScheduleValue,
} from "./social-post-schedule-picker";

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

function resolveTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  const formatter = useFormatter();
  const viewerTimezone = resolveTimezone();
  const post = mode.kind === "create" ? null : mode.post;
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInFlightRef = useRef(false);
  const scheduledAtId = useId();
  const driveStore = driveStoreForActiveWorkspace(
    session?.session.activeOrganizationId ?? null,
  );

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
  const [media, setMedia] = useState<SocialPostMediaRef[]>(
    post?.media ? [...post.media] : [],
  );
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(
    post?.scheduledAt ? "later" : "now",
  );
  const [scheduledAt, setScheduledAt] = useState(
    post?.scheduledAt ? toScheduleValue(post.scheduledAt) : "",
  );
  const [pending, setPending] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isBusy = pending || uploadPending;
  const selectedConnections = activeConnections.filter((c) =>
    selectedConnectionIds.has(c.id),
  );

  // Character limits and validation
  const providers = socialPostComposerProviders(
    post?.provider,
    selectedConnections.map((c) => c.provider),
  );
  const provider = providers.reduce((strictest, candidate) =>
    SOCIAL_POST_TEXT_LIMITS[candidate] < SOCIAL_POST_TEXT_LIMITS[strictest]
      ? candidate
      : strictest,
  );
  const textLimit = SOCIAL_POST_TEXT_LIMITS[provider];
  const accept = socialPostComposerAccept(providers);
  const issueProvider =
    providers.find(
      (candidate) => socialPostComposerIssue(candidate, text, media) !== null,
    ) ?? provider;
  const composerIssue = socialPostComposerIssue(issueProvider, text, media);
  const trimmedText = text.trim();
  const overLimit = text.length > textLimit;
  const mediaValid = providers.every(
    (candidate) => validateSocialPostMedia(candidate, media).ok,
  );
  const textValid = composerIssue === null && !overLimit;
  const earliestScheduledAt = Date.now() + SOCIAL_POST_MIN_SCHEDULE_LEAD_MS;
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const scheduledAtTooSoon =
    scheduledDate !== null &&
    !Number.isNaN(scheduledDate.getTime()) &&
    scheduledDate.getTime() <= earliestScheduledAt;
  const scheduledAtValid =
    scheduledDate !== null &&
    !Number.isNaN(scheduledDate.getTime()) &&
    !scheduledAtTooSoon;

  const canPublish =
    textValid &&
    mediaValid &&
    selectedConnectionIds.size > 0 &&
    scheduleMode === "now" &&
    !isBusy;

  const canSchedule =
    textValid &&
    mediaValid &&
    selectedConnectionIds.size > 0 &&
    scheduleMode === "later" &&
    scheduledAtValid &&
    !isBusy;

  function toggleConnection(id: string) {
    const next = new Set(selectedConnectionIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedConnectionIds(next);
  }

  function mediaErrorText(
    reason: SocialPostMediaValidationReason,
    rejectedBy: typeof provider,
  ): string {
    return t(`composer.media.errors.${reason}`, {
      provider: socialPostProviderLabel(rejectedBy),
      max: SOCIAL_POST_MEDIA_RULES[rejectedBy].maxImages,
    });
  }

  function mediaRejection(
    next: SocialPostMediaRef[],
  ): { reason: SocialPostMediaValidationReason; by: typeof provider } | null {
    for (const candidate of providers) {
      const check = validateSocialPostMedia(candidate, next);
      if (!check.ok) return { reason: check.reason, by: candidate };
    }
    return null;
  }

  function attachMedia(ref: SocialPostMediaRef): void {
    if (hasSocialPostMedia(media, ref.pathname)) {
      toast.error(t("composer.media.alreadyAttached"));
      return;
    }
    const rejection = mediaRejection([...media, ref]);
    if (rejection) {
      toast.error(mediaErrorText(rejection.reason, rejection.by));
      return;
    }
    setMedia((current) => [...current, ref]);
  }

  function handleSelectDriveFile(file: DriveFile): void {
    const ref = socialPostMediaRefFromDriveFile(file);
    if (!ref) {
      toast.error(
        t("composer.media.unsupported", {
          provider: socialPostProviderLabel(provider),
        }),
      );
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
      toast.error(
        t("composer.media.unsupported", {
          provider: socialPostProviderLabel(provider),
        }),
      );
      return;
    }
    const rejection = mediaRejection([...media, candidate]);
    if (rejection) {
      toast.error(mediaErrorText(rejection.reason, rejection.by));
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
      if (isDriveFileUploadDuplicate(uploaded)) {
        toast.error(t("composer.media.uploadDuplicate"));
        return;
      }
      attachMedia(ref);
    } catch (_error) {
      toast.error(t("composer.media.uploadFailed"));
    } finally {
      uploadInFlightRef.current = false;
      setUploadPending(false);
    }
  }

  async function handlePublish() {
    if (!canPublish || pending) return;

    setPending(true);
    try {
      let published = 0;
      const accounts = Array.from(selectedConnectionIds);

      for (const connectionId of accounts) {
        const createResult = await createProjectSocialPost({
          projectId,
          text: trimmedText,
          media,
          socialConnectionId: connectionId,
        });

        if (!createResult.ok) {
          onError(createResult.error);
          return;
        }

        const publishResult = await publishProjectSocialPost({
          projectId,
          postId: createResult.value.id,
          revision: createResult.value.revision,
        });

        if (!publishResult.ok) {
          onSaved(createResult.value);
          onError(publishResult.error);
          return;
        }

        published++;
        onSaved(publishResult.value);
      }

      toast.success(t("toasts.publishedMany", { count: published }));
      onOpenChange(false);
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setPending(false);
    }
  }

  async function handleSchedule() {
    if (!canSchedule || !scheduledDate) return;

    setPending(true);
    const scheduledAtIso = scheduledDate.toISOString();
    const timezone = viewerTimezone;

    try {
      let created = 0;
      const accounts = Array.from(selectedConnectionIds);

      for (const connectionId of accounts) {
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

        created++;
        onSaved(result.value);
      }

      toast.success(t("toasts.scheduled", { count: created }));
      onOpenChange(false);
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setPending(false);
    }
  }

  const mediaStrip =
    media.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {media.map((ref) => (
          <div key={ref.pathname} className="relative">
            <FileChipMiniPreview
              fileName={ref.name}
              mediaType={ref.mimeType}
              size={ref.size}
              sizeClass="size-16"
              url={ref.fileUrl}
            />
            <button
              aria-label={t("composer.media.remove", { name: ref.name })}
              className="bg-background border-border hover:bg-accent absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border"
              disabled={isBusy}
              onClick={() => handleRemoveMedia(ref.pathname)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
    ) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {mode.kind === "create"
                ? t("composer.newTitle")
                : t("composer.editTitle")}
            </DialogTitle>
            <DialogDescription>
              All active accounts selected. Type and post.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Text editor */}
            <div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("composer.textPlaceholder")}
                className="min-h-[120px] resize-none"
                autoFocus
                disabled={isBusy}
              />

              {/* Character counts */}
              {text.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {providers.map((p) => {
                    const limit = SOCIAL_POST_TEXT_LIMITS[p];
                    const over = text.length > limit;
                    return (
                      <span
                        key={p}
                        className={cn(
                          over ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {socialPostProviderLabel(p)}: {text.length}/{limit}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Media */}
            {mediaStrip}
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={isBusy}
                onClick={() => setPickerOpen(true)}
              >
                <ImagePlus className="size-4" aria-hidden />
                {t("composer.media.addFromDrive")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={isBusy || uploadPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden />
                {t("composer.media.upload")}
              </Button>
              <input
                ref={fileInputRef}
                accept={accept}
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
            </div>

            {/* Account selection */}
            <div>
              <p className="text-sm font-medium mb-2">
                {t("composer.accounts")}
              </p>
              <div className="flex flex-wrap gap-2">
                {activeConnections.map((conn) => {
                  const selected = selectedConnectionIds.has(conn.id);
                  return (
                    <button
                      key={conn.id}
                      type="button"
                      onClick={() => toggleConnection(conn.id)}
                      disabled={isBusy}
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
                  disabled={isBusy}
                >
                  {t("composer.postNow")}
                </Button>
                <Button
                  type="button"
                  variant={scheduleMode === "later" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScheduleMode("later")}
                  disabled={isBusy}
                >
                  <Calendar className="size-4 mr-2" />
                  {t("composer.scheduleLater")}
                </Button>
              </div>

              {scheduleMode === "later" && (
                <div className="mt-3">
                  <SocialPostSchedulePicker
                    allowNow={false}
                    disabled={isBusy}
                    earliest={new Date(earliestScheduledAt)}
                    invalid={scheduledAtTooSoon}
                    labelledBy={scheduledAtId}
                    onChange={setScheduledAt}
                    value={scheduledAt}
                  />
                  <p className="text-muted-foreground text-xs mt-2">
                    {scheduledAtValid && scheduledDate
                      ? t("composer.timezone.goesOut", {
                          date: formatter.dateTime(
                            scheduledDate,
                            "dateTimeWithYear",
                          ),
                          zone: viewerTimezone.replaceAll("_", " "),
                        })
                      : t("composer.timezone.yours", {
                          zone: viewerTimezone.replaceAll("_", " "),
                        })}
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              {t("composer.close")}
            </Button>
            <Button
              type="button"
              onClick={scheduleMode === "now" ? handlePublish : handleSchedule}
              disabled={
                scheduleMode === "now" ? !canPublish : !canSchedule || pending
              }
            >
              {pending
                ? t("composer.publishing")
                : scheduleMode === "now"
                  ? t("composer.post")
                  : t("composer.schedule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DriveFilePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handleSelectDriveFile}
      />
    </>
  );
}
