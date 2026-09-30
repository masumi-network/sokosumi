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
import { ImagePlus, Loader2, Upload } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type ActionError,
  toActionRejectionError,
} from "@/lib/actions/errors/action-error";
import {
  createProjectSocialPost,
  publishProjectSocialPost,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
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
  socialPostComposerFormat,
  socialPostComposerIssue,
  socialPostComposerProviders,
} from "./social-post-composer-rules";
import {
  buildSocialPostMediaRef,
  hasSocialPostMedia,
  sameSocialPostMedia,
  socialPostMediaRefFromDriveFile,
} from "./social-post-media";
import {
  SocialPostSchedulePicker,
  toScheduleValue,
} from "./social-post-schedule-picker";

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

type PendingSubmit = "save" | "schedule" | "publish" | null;

function formatHandle(handle: string | null): string {
  if (!handle) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/** An IANA zone as people read it: `America/New_York` → `America/New York`. */
function zoneName(timezone: string): string {
  return timezone.replaceAll("_", " ");
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
  const formatter = useFormatter();
  const viewerTimezone = resolveTimezone();
  const textId = useId();
  const accountsLabelId = useId();
  const scheduledAtId = useId();
  const scheduledAtErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInFlightRef = useRef(false);
  const post = mode.kind === "create" ? null : mode.post;
  const { data: session } = useSession();
  const driveStore = driveStoreForActiveWorkspace(
    session?.session.activeOrganizationId ?? null,
  );

  const [text, setText] = useState(post?.text ?? "");
  const [media, setMedia] = useState<SocialPostMediaRef[]>(
    post?.media ? [...post.media] : [],
  );
  // A new post may go to several accounts at once, one post each; an existing
  // post belongs to one account.
  const multiAccount = mode.kind === "create";
  const [connectionIds, setConnectionIds] = useState<string[]>(() => {
    const initial = post?.socialConnection?.id ?? connections[0]?.id;
    return initial ? [initial] : [];
  });
  const [scheduledAt, setScheduledAt] = useState(
    post?.scheduledAt ? toScheduleValue(post.scheduledAt) : "",
  );
  const [pending, setPending] = useState<PendingSubmit>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isScheduleOnly = mode.kind === "schedule";
  const isBusy = pending !== null || uploadPending;
  const selectedConnections = connections.filter((connection) =>
    connectionIds.includes(connection.id),
  );
  const connectionId = selectedConnections[0]?.id ?? "";
  const providers = socialPostComposerProviders(
    post?.provider,
    selectedConnections.map((connection) => connection.provider),
  );
  // One text goes to every selected account, so the strictest one rules.
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
  const textValid = isScheduleOnly || (composerIssue === null && !overLimit);
  const requirementHint =
    composerIssue === "text_required" ||
    composerIssue === "text_or_media_required" ||
    composerIssue === "media_required" ||
    composerIssue === "video_required"
      ? composerIssue
      : null;
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
  const canSchedule =
    textValid &&
    mediaValid &&
    connectionId !== "" &&
    scheduledAtValid &&
    !isBusy;
  const canSave = textValid && !isBusy;
  // Posting now is for a new post: the fastest path is open, type, post.
  const canPublishNow =
    mode.kind === "create" &&
    textValid &&
    mediaValid &&
    selectedConnections.length > 0 &&
    !isBusy;
  // With no time picked, posting now is what the reader is here to do.
  const publishNowIsPrimary = mode.kind === "create" && scheduledAt === "";
  const isReschedule = post?.status === "SCHEDULED";

  function toggleConnection(id: string): void {
    setConnectionIds((current) => {
      if (!multiAccount) return [id];
      return current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id];
    });
  }

  const title =
    mode.kind === "create"
      ? t("composer.newTitle")
      : mode.kind === "edit"
        ? t("composer.editTitle")
        : isReschedule
          ? t("composer.rescheduleTitle")
          : t("composer.scheduleTitle");

  function mediaErrorText(
    reason: SocialPostMediaValidationReason,
    rejectedBy: typeof provider,
  ): string {
    return t(`composer.media.errors.${reason}`, {
      provider: socialPostProviderLabel(rejectedBy),
      max: SOCIAL_POST_MEDIA_RULES[rejectedBy].maxImages,
    });
  }

  /** The first selected provider that refuses this media, with its reason. */
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

  /**
   * One post per selected account, in the order they were picked; a draft
   * with no account is a single post. Stops at the first failure so the
   * reader sees one error, and returns how many were saved. Accounts saved
   * before a failure leave the selection, so trying again covers only the
   * ones that failed instead of saving a second copy for the others.
   */
  async function createForEachAccount(
    create: (
      socialConnectionId: string | null,
    ) => ReturnType<typeof createProjectSocialPost>,
  ): Promise<number> {
    const targets: (string | null)[] =
      selectedConnections.length > 0
        ? selectedConnections.map((connection) => connection.id)
        : [null];
    let created = 0;
    const saved: string[] = [];
    try {
      for (const socialConnectionId of targets) {
        const result = await create(socialConnectionId);
        if (!result.ok) {
          onError(result.error);
          return 0;
        }
        onSaved(result.value);
        if (socialConnectionId) saved.push(socialConnectionId);
        created += 1;
      }
      return created;
    } finally {
      if (created < targets.length && saved.length > 0) {
        setConnectionIds((current) =>
          current.filter((id) => !saved.includes(id)),
        );
      }
    }
  }

  /**
   * Creates the post for each picked account and publishes it at once. A
   * post that fails to publish stays in Needs attention to retry, so the
   * reader loses nothing; the toast names the first failure.
   */
  async function handlePublishNow(): Promise<void> {
    if (!canPublishNow) return;
    setPending("publish");
    let published = 0;
    let failure: string | null = null;
    // Accounts whose post now exists, live or in Needs attention. If the run
    // stops early they leave the selection, so Post now again never posts a
    // second copy to them.
    const done: string[] = [];
    try {
      for (const connection of selectedConnections) {
        const created = await createProjectSocialPost({
          projectId,
          text: trimmedText,
          media,
          socialConnectionId: connection.id,
        });
        if (!created.ok) {
          onError(created.error);
          return;
        }
        const result = await publishProjectSocialPost({
          projectId,
          postId: created.value.id,
          revision: created.value.revision,
        });
        done.push(connection.id);
        if (!result.ok) {
          onSaved(created.value);
          onError(result.error);
          return;
        }
        onSaved(result.value);
        if (result.value.status === "PUBLISHED") {
          published += 1;
        } else {
          failure ??=
            result.value.lastAttempt?.outcome === "authorization_revoked"
              ? t("outcomes.authorizationRevoked")
              : (result.value.lastError ?? t("toasts.failed"));
        }
      }
      if (failure) {
        toast.error(t("toasts.publishFailed", { error: failure }));
      } else {
        toast.success(t("toasts.publishedMany", { count: published }));
      }
      onOpenChange(false);
    } catch (error) {
      onError(toActionRejectionError(error));
    } finally {
      setPending(null);
      if (done.length > 0 && done.length < selectedConnections.length) {
        setConnectionIds((current) =>
          current.filter((id) => !done.includes(id)),
        );
      }
    }
  }

  /** What ⌘/Ctrl+Enter runs: the main action for what the reader has filled. */
  const shortcutAction: Exclude<PendingSubmit, null> =
    // Picking a time is all the schedule dialog does, so there it schedules
    // (or waits for a time) and never saves a new draft.
    scheduledAt !== "" || isScheduleOnly
      ? "schedule"
      : mode.kind === "create"
        ? "publish"
        : "save";

  function handleSubmitShortcut(): void {
    if (shortcutAction === "schedule") void handleSchedule();
    else if (shortcutAction === "publish") void handlePublishNow();
    else void handleSaveDraft();
  }

  /** The shortcut, shown on the button it runs. */
  function shortcutHint(action: Exclude<PendingSubmit, null>) {
    if (action !== shortcutAction) return null;
    return (
      <kbd
        aria-hidden
        className="hidden font-sans text-xs opacity-70 sm:inline"
      >
        ⌘↵
      </kbd>
    );
  }

  async function handleSaveDraft(): Promise<void> {
    if (!canSave) return;
    setPending("save");
    try {
      if (mode.kind === "edit") {
        const result = await updateProjectSocialPost({
          projectId,
          postId: mode.post.id,
          text: trimmedText,
          media,
          socialConnectionId: connectionId || null,
          revision: mode.post.revision,
        });
        if (!result.ok) {
          onError(result.error);
          return;
        }
        toast.success(t("toasts.updated"));
        onSaved(result.value);
        onOpenChange(false);
        return;
      }

      const created = await createForEachAccount((socialConnectionId) =>
        createProjectSocialPost({
          projectId,
          text: trimmedText,
          media,
          socialConnectionId,
        }),
      );
      if (created === 0) return;
      toast.success(t("toasts.created", { count: created }));
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
    const timezone = viewerTimezone;
    try {
      if (mode.kind === "create") {
        const created = await createForEachAccount((socialConnectionId) =>
          createProjectSocialPost({
            projectId,
            text: trimmedText,
            media,
            socialConnectionId,
            scheduledAt: scheduledAtIso,
            timezone,
          }),
        );
        if (created === 0) return;
        toast.success(t("toasts.scheduled", { count: created }));
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
      toast.success(t("toasts.scheduled", { count: 1 }));
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
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing &&
            // Keys bubble through portals: ⌘Enter in the Drive picker or a
            // date or time popover belongs to them, not to this dialog.
            !pickerOpen &&
            event.target instanceof Node &&
            event.currentTarget.contains(event.target)
          ) {
            event.preventDefault();
            handleSubmitShortcut();
          }
        }}
        onOpenAutoFocus={(event) => {
          // Straight to the text: the account is already picked.
          if (isScheduleOnly) return;
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
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
          <div className="space-y-2">
            <p className="text-sm font-medium" id={accountsLabelId}>
              {multiAccount ? t("composer.accounts") : t("composer.account")}
            </p>
            {connections.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="social-post-no-accounts"
              >
                {t("composer.noAccounts")}
              </p>
            ) : (
              <div
                aria-labelledby={accountsLabelId}
                className="flex flex-wrap gap-2"
                data-testid="social-post-accounts"
                role="group"
              >
                {connections.map((connection) => {
                  const selected = connectionIds.includes(connection.id);
                  const handle =
                    formatHandle(connection.externalHandle) ||
                    t("composer.unknownHandle");
                  return (
                    <Button
                      aria-label={t("composer.accountOption", {
                        provider: socialPostProviderLabel(connection.provider),
                        handle,
                      })}
                      aria-pressed={selected}
                      className={cn(
                        "h-9 gap-2 rounded-full px-3",
                        selected
                          ? "border-primary bg-primary-quinary text-foreground hover:bg-primary-quaternary"
                          : "text-muted-foreground",
                      )}
                      disabled={isBusy}
                      key={connection.id}
                      onClick={() => toggleConnection(connection.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <SocialPostProviderIcon
                        aria-hidden
                        className="size-4"
                        provider={connection.provider}
                      />
                      <span className="max-w-40 truncate">{handle}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

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
                {/* One platform: the count above already is its limit. */}
                {providers.length > 1 ? (
                  <ul
                    aria-label={t("composer.platforms")}
                    className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
                    data-testid="social-post-platforms"
                  >
                    {providers.map((candidate) => {
                      const limit = SOCIAL_POST_TEXT_LIMITS[candidate];
                      const over = text.length > limit;
                      return (
                        <li
                          className={cn(
                            "inline-flex items-center gap-1.5",
                            over ? "text-destructive" : "text-muted-foreground",
                          )}
                          data-testid={`social-post-platform-${candidate}`}
                          key={candidate}
                        >
                          <SocialPostProviderIcon
                            aria-hidden
                            className="size-3.5"
                            provider={candidate}
                          />
                          <span>
                            {t("composer.platformLimit", {
                              provider: socialPostProviderLabel(candidate),
                              format: t(
                                `composer.formats.${socialPostComposerFormat(candidate)}`,
                              ),
                              count: text.length,
                              limit,
                            })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <Textarea
                  id={textId}
                  aria-invalid={overLimit || undefined}
                  disabled={isBusy}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={t("composer.textPlaceholder")}
                  ref={textareaRef}
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
                      <Loader2
                        className="size-4 animate-spin motion-reduce:animate-pulse"
                        aria-hidden
                      />
                    ) : (
                      <Upload className="size-4" aria-hidden />
                    )}
                    {uploadPending
                      ? t("composer.media.uploading")
                      : t("composer.media.upload")}
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
                  <span className="text-muted-foreground text-xs">
                    {t("composer.media.hint", {
                      provider: socialPostProviderLabel(provider),
                    })}
                  </span>
                </div>
                {requirementHint ? (
                  <p
                    className="text-muted-foreground text-xs"
                    data-testid="social-post-requirement-hint"
                  >
                    {t(`composer.requirements.${requirementHint}`, {
                      provider: socialPostProviderLabel(issueProvider),
                    })}
                  </p>
                ) : null}
              </div>
            </>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium" id={scheduledAtId}>
              {t("composer.scheduledAt")}
            </p>
            <SocialPostSchedulePicker
              describedBy={scheduledAtTooSoon ? scheduledAtErrorId : undefined}
              disabled={isBusy}
              earliest={new Date(earliestScheduledAt)}
              invalid={scheduledAtTooSoon}
              labelledBy={scheduledAtId}
              onChange={setScheduledAt}
              value={scheduledAt}
            />
            <div
              className="text-muted-foreground space-y-0.5 text-xs"
              data-testid="social-post-timezone"
            >
              {/* A post goes out at one instant; the picker and this line
                  read it in the viewer's zone, and name that zone. */}
              <p>
                {scheduledAtValid && scheduledDate
                  ? t("composer.timezone.goesOut", {
                      date: formatter.dateTime(
                        scheduledDate,
                        "dateTimeWithYear",
                      ),
                      zone: zoneName(viewerTimezone),
                    })
                  : t("composer.timezone.yours", {
                      zone: zoneName(viewerTimezone),
                    })}
              </p>
              {post?.scheduledAt &&
              post.timezone &&
              post.timezone !== viewerTimezone ? (
                <p>
                  {t("composer.timezone.postZone", {
                    date: formatter.dateTime(
                      post.scheduledAt,
                      "dateTimeWithYear",
                      { timeZone: post.timezone },
                    ),
                    zone: zoneName(post.timezone),
                  })}
                </p>
              ) : null}
            </div>
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
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : null}
              {mode.kind === "edit" && mode.post.status !== "DRAFT"
                ? t("composer.save")
                : t("composer.saveDraft")}
              {shortcutHint("save")}
            </Button>
          )}
          {mode.kind === "create" ? (
            <Button
              type="button"
              variant={publishNowIsPrimary ? "default" : "outline"}
              disabled={!canPublishNow}
              onClick={() => {
                void handlePublishNow();
              }}
            >
              {pending === "publish" ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : null}
              {t("composer.publishNow")}
              {shortcutHint("publish")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={publishNowIsPrimary ? "outline" : "default"}
            disabled={!canSchedule}
            onClick={() => {
              void handleSchedule();
            }}
          >
            {pending === "schedule" ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-pulse"
                aria-hidden
              />
            ) : null}
            {isReschedule ? t("composer.reschedule") : t("composer.schedule")}
            {shortcutHint("schedule")}
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
