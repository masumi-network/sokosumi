"use client";

import {
  extractFileLikeLinks,
  extractHttpLinks,
  type SubscriptionPlanName,
} from "@sokosumi/utils";
import { ArrowUp, Command, CornerDownLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import {
  getEventActorInfo,
  resolveTaskEventActorKind,
  type TaskActivityActorInfo,
} from "@/app/tasks/utils/task-activity-actors";
import { AssistantOrb } from "@/components/aurora-orb";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { SourcesGrid } from "@/components/sources/sources-grid";
import { TimeAgo } from "@/components/time-ago";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Separator } from "@/components/ui/separator";
import { useOSDetection } from "@/hooks/use-os-detection";
import { createTaskComment } from "@/lib/actions/task/action";
import { BlobStatus, Channel, TaskStatus } from "@/lib/clients/generated/core";
import type { TaskEvent } from "@/lib/clients/generated/core/types.gen";
import {
  CHANNEL_APP_NAME_KEY_MAP,
  CHANNEL_ICON_MAP,
} from "@/lib/constants/channel-icons";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";
import {
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
} from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import { getInitials } from "@/lib/utils/text";
import { getFileNameFromUrl } from "@/lib/utils/url";
import { getUserFileUploadErrorMessage } from "@/lib/utils/user-file-upload.client";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import { createTaskAttachmentUploadToast } from "./task-attachment-upload-toast";
import {
  getTaskStatusBorderColorClass,
  getTaskStatusDotColorClass,
  TaskStatusBadge,
} from "./task-status-badge";

interface TaskActivityProps {
  taskId: string;
  title: string;
  placeholder: string;
  attachLabel: string;
  submitLabel: string;
  actorCoworkerLabel: string;
  actorUserLabel: string;
  actorOrchestratorLabel: string;
  actorSystemLabel: string;
  actionCommentedLabel: string;
  actionUpdatedStatusLabel: string;
  events: TaskEvent[];
  agentNameById?: Map<string, string>;
  userById?: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  orchestratorById?: Record<string, TaskActivityActorInfo>;
  currentUser?: ({ id: string } & TaskActivityActorInfo) | null;
  expandLabel?: string;
  collapseLabel?: string;
  /**
   * Viewer's subscription plan for out-of-credits billing CTAs.
   * `null` when the plan is unavailable (admin/read-only, membership miss) —
   * show status copy but no billing link for the viewer.
   */
  viewerPlan?: SubscriptionPlanName | null;
  canComment?: boolean;
}

function getEventTimestamp(event: TaskEvent): number {
  return new Date(event.createdAt).getTime();
}

function isNewOptimisticEventId(id: string): boolean {
  return id.startsWith("optimistic:");
}

function AnimatedNewRow({ children }: { children: ReactNode }) {
  const [isEntered, setIsEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={[
        "overflow-hidden",
        "transition-[max-height,opacity,transform]",
        "duration-300",
        "ease-out",
        "motion-reduce:transition-none",
        isEntered
          ? "max-h-[600px] translate-y-0 opacity-100"
          : "max-h-0 -translate-y-2 opacity-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function TaskActivitySection({
  taskId,
  title,
  placeholder,
  attachLabel: _attachLabel,
  submitLabel,
  actorCoworkerLabel,
  actorUserLabel,
  actorOrchestratorLabel,
  actorSystemLabel,
  actionCommentedLabel,
  actionUpdatedStatusLabel,
  events,
  agentNameById,
  userById,
  coworkerById,
  orchestratorById,
  currentUser,
  expandLabel = "Expand",
  collapseLabel = "Show less",
  viewerPlan = null,
  canComment = true,
}: TaskActivityProps) {
  const t = useTranslations("App.Tasks.Detail");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const locale = useLocale();
  const resolvedAgentNameById = useMemo(
    () => agentNameById ?? new Map<string, string>(),
    [agentNameById],
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const activeUploadControllersRef = useRef(new Set<AbortController>());
  const [comment, setComment] = useState("");
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadingAttachmentsCount, setUploadingAttachmentsCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);
  const { os, isMobile } = useOSDetection();
  const mentionOptions = useMemo(
    () => convertAgentNamesToMentionOptions(resolvedAgentNameById),
    [resolvedAgentNameById],
  );
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(comment),
    [comment],
  );

  useEffect(() => {
    setLocalEvents(events);
  }, [events]);

  const abortActiveUploads = useCallback(() => {
    for (const controller of activeUploadControllersRef.current) {
      controller.abort();
    }
    activeUploadControllersRef.current.clear();
  }, []);

  useEffect(() => abortActiveUploads, [abortActiveUploads]);

  const orderedEvents = useMemo(() => {
    return [...localEvents].sort(
      (a, b) => getEventTimestamp(b) - getEventTimestamp(a),
    );
  }, [localEvents]);

  const latestStatusEventId = useMemo(
    () => orderedEvents.find((event) => event.status)?.id ?? null,
    [orderedEvents],
  );

  const trimmedComment = comment.trim();
  const isUploadingAttachments = uploadingAttachmentsCount > 0;
  const isSubmitDisabled =
    !canComment ||
    isPending ||
    trimmedComment.length === 0 ||
    !currentUser?.id ||
    isUploadingAttachments;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    const optimisticEvent: TaskEvent = {
      id: `optimistic:${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      taskId,
      status: null,
      comment: trimmedComment,
      authenticationUrl: null,
      channel: Channel.SOKOSUMI,
      origin: Channel.SOKOSUMI,
      actor: currentUser
        ? {
            type: "user",
            id: currentUser.id,
            user: {
              id: currentUser.id,
              name: currentUser.name,
              image: currentUser.image,
            },
          }
        : null,
      userId: currentUser?.id ?? null,
      user: currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            image: currentUser.image,
          }
        : null,
      coworkerId: null,
      transactionId: null,
      credits: null,
    };

    setLocalEvents((prev) => [optimisticEvent, ...prev]);
    setComment("");

    startTransition(() => {
      void (async () => {
        try {
          await createTaskComment({
            taskId,
            comment: trimmedComment,
          });
          router.refresh();
        } catch {
          setLocalEvents((prev) =>
            prev.filter((entry) => entry.id !== optimisticEvent.id),
          );
          setComment(trimmedComment);
        }
      })();
    });
  }

  const handleAttachFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const uploadToast = createTaskAttachmentUploadToast({
      files,
      labels: {
        uploadingFile: getTaskAttachmentUploadLabelTemplate(t, "uploadingFile"),
        uploadingFiles: getTaskAttachmentUploadLabelTemplate(
          t,
          "uploadingFiles",
        ),
      },
    });

    const controller = new AbortController();
    activeUploadControllersRef.current.add(controller);
    setUploadingAttachmentsCount((count) => count + 1);
    try {
      for (const [index, file] of files.entries()) {
        const uploadedUrl = await uploadTaskAttachment(file, {
          abortSignal: controller.signal,
          onUploadProgress: (progress) => {
            uploadToast.updateFileProgress(index, progress);
          },
        });
        uploadToast.markFileComplete(index);
        const safeName = sanitizeTaskAttachmentLabel(file.name, t("fileLabel"));
        if (markdownEditorRef.current) {
          markdownEditorRef.current.insertLink(safeName, uploadedUrl);
          markdownEditorRef.current.insertText("\n");
          continue;
        }
        const markdownLink = formatTaskAttachmentMarkdown(
          safeName,
          uploadedUrl,
        );
        setComment(
          (prev) => `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
        );
      }
      uploadToast.dismiss();
    } catch (error) {
      uploadToast.dismiss();
      toast.error(
        getUserFileUploadErrorMessage(error, t("uploadFileErrorRetry")),
      );
    } finally {
      activeUploadControllersRef.current.delete(controller);
      setPendingUploadFiles([]);
      setUploadingAttachmentsCount((count) => count - 1);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>

      {canComment ? (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="border-border/50 rounded-lg border p-3"
        >
          <FileUpload
            value={pendingUploadFiles}
            onValueChange={setPendingUploadFiles}
            onAccept={(files) => {
              void handleAttachFiles(files);
            }}
            multiple
          >
            <FileUploadDropzone
              className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
              onClick={(event) => event.preventDefault()}
            >
              <MarkdownEditor
                ref={markdownEditorRef}
                placeholder={placeholder}
                className="border-border/50 bg-muted-foreground/5 w-full rounded-lg border"
                value={comment}
                onChange={setComment}
                onSubmitShortcut={() => formRef.current?.requestSubmit()}
                onAttachClick={() => attachmentTriggerRef.current?.click()}
                attachLabel={_attachLabel}
                isAttachmentUploading={isUploadingAttachments}
                mentions={mentionOptions}
              />
              <FileUploadTrigger asChild>
                <button
                  ref={attachmentTriggerRef}
                  type="button"
                  className="sr-only"
                  aria-label={_attachLabel}
                >
                  {_attachLabel}
                </button>
              </FileUploadTrigger>
            </FileUploadDropzone>
          </FileUpload>
          {attachmentUrls.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-3">
              {attachmentUrls.map((url) => (
                <FileChipMiniPreviewWithMetadata
                  key={url}
                  url={url}
                  onRemove={() =>
                    setComment((prev) => removeTaskAttachmentLinks(prev, [url]))
                  }
                  removeLabel={t("removeAttachment")}
                />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-3">
            {!isMobile ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <span>{t("sendWith")}</span>
                <div className="flex items-center gap-0.5 opacity-60">
                  {os === "MacOS" ? (
                    <Command className="size-3" aria-hidden />
                  ) : (
                    <span className="text-xs">{t("ctrl")}</span>
                  )}
                  <CornerDownLeft className="size-3" aria-hidden />
                </div>
              </div>
            ) : null}
            <Button
              size="icon"
              className="ml-auto size-7 rounded-full"
              aria-label={submitLabel}
              type="submit"
              disabled={isSubmitDisabled}
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-3.5" aria-hidden />
              )}
            </Button>
          </div>
        </form>
      ) : null}

      {orderedEvents.length > 0 ? (
        <div className="space-y-3">
          {orderedEvents.map((event, index) => {
            const actorKind = resolveTaskEventActorKind(event);
            const actorLabel =
              actorKind === "coworker"
                ? actorCoworkerLabel
                : actorKind === "user"
                  ? actorUserLabel
                  : actorKind === "orchestrator"
                    ? actorOrchestratorLabel
                    : actorSystemLabel;
            const actorInfo = getEventActorInfo(
              event,
              userById,
              coworkerById,
              orchestratorById,
            );
            const actorName =
              actorInfo?.ownerName != null
                ? t("actorOrchestratorWithOwner", {
                    assistant: actorInfo.name,
                    owner: actorInfo.ownerName,
                  })
                : (actorInfo?.name ?? actorLabel);
            const actorImage = actorInfo?.image ?? null;
            const showAssistantOrb = actorKind === "orchestrator";
            const ChannelIcon = CHANNEL_ICON_MAP[event.channel];
            const channelAppName = t(
              `channelApp.${CHANNEL_APP_NAME_KEY_MAP[event.channel]}`,
            );
            const originFromLabel = t("originFromApp", {
              appName: channelAppName,
            });
            const isNewOptimisticEvent = isNewOptimisticEventId(event.id);
            const formattedComment = event.comment
              ? formatMentionsAsMarkdownLinks(
                  event.comment,
                  resolvedAgentNameById,
                )
              : null;
            const sourceFiles = formattedComment
              ? extractFileLikeLinks(formattedComment).map(
                  (url, fileIndex) => ({
                    id: `${event.id}-file-${fileIndex}`,
                    sourceUrl: url,
                    fileUrl: url,
                    name: getFileNameFromUrl(url),
                    status: BlobStatus.READY,
                  }),
                )
              : [];
            const sourceLinks = formattedComment
              ? extractHttpLinks(formattedComment).map((url, linkIndex) => ({
                  id: `${event.id}-link-${linkIndex}`,
                  url,
                }))
              : [];
            const hasCommentSources =
              sourceFiles.length > 0 || sourceLinks.length > 0;
            const chargedLabel =
              event.credits != null
                ? t(
                    event.transactionId == null
                      ? "actionTriedChargedCredits"
                      : "actionChargedCredits",
                    {
                      credits: formatCreditsForDisplay(event.credits),
                    },
                  )
                : null;
            const hasComment = Boolean(event.comment?.trim());
            const action = hasComment
              ? actionCommentedLabel
              : event.status
                ? actionUpdatedStatusLabel
                : (chargedLabel ?? actionUpdatedStatusLabel);
            const shouldShowSecondaryChargeLine =
              chargedLabel != null && (hasComment || event.status != null);
            const shouldShowAuthenticateButton =
              index === 0 &&
              event.status === TaskStatus.AUTHENTICATION_REQUIRED &&
              Boolean(event.authenticationUrl);
            const isOutOfCreditsEvent =
              index === 0 && event.status === TaskStatus.OUT_OF_CREDITS;
            // Only link to billing when we know the viewer's plan. Unknown
            // (admin / outside workspace) must not pretend the viewer is free.
            const shouldShowBillingButton =
              isOutOfCreditsEvent && viewerPlan != null;
            const isFreePlan = viewerPlan === "free";
            const billingCtaLabel = isFreePlan
              ? t("billingCta.upgradePlan")
              : t("billingCta.addCredits");
            const billingCtaHref = isFreePlan
              ? "/billing?tab=subscription"
              : "/billing?tab=credits";
            const billingPlaceholderLabel =
              viewerPlan == null
                ? t("billingCta.statusUnavailable")
                : t("billingCta.placeholder");
            const isCommentEvent = Boolean(formattedComment);
            const isAuthEvent = shouldShowAuthenticateButton;
            const isBillingEvent = isOutOfCreditsEvent;
            const shouldShowBillingPlaceholder =
              isBillingEvent && !formattedComment;
            const isCardEvent = isCommentEvent || isAuthEvent || isBillingEvent;
            const shouldHighlightDoneBorder =
              event.status === TaskStatus.COMPLETED && isCommentEvent;
            const isStatusOnlyEvent = !isCardEvent && Boolean(event.status);
            const isLatestStatusEvent =
              Boolean(event.status) && event.id === latestStatusEventId;

            const row = (
              <div
                key={event.id}
                className={cn(
                  "rounded-lg pr-3 pl-3",
                  isCardEvent && "bg-muted/20 border-border/50 border",
                  shouldHighlightDoneBorder &&
                    getTaskStatusBorderColorClass(TaskStatus.COMPLETED),
                )}
              >
                <div
                  className={cn(
                    "flex items-center gap-4",
                    isCardEvent && "py-3",
                  )}
                >
                  {isStatusOnlyEvent && event.status ? (
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      <span
                        data-testid={`status-dot-${event.id}`}
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          getTaskStatusDotColorClass(event.status),
                        )}
                        aria-hidden
                      />
                    </div>
                  ) : showAssistantOrb ? (
                    <AssistantOrb
                      seed={actorInfo?.avatarSeed ?? null}
                      // Resting eyes so the assistant's comment avatar reads
                      // as a face, not a blank disc.
                      expression="idle"
                      animate={false}
                      size={24}
                      className="size-6 shrink-0 self-start"
                      alt={actorName}
                    />
                  ) : (
                    <Avatar className="size-6 shrink-0 self-start">
                      {actorImage ? (
                        <AvatarImage src={actorImage} alt={actorName} />
                      ) : null}
                      <AvatarFallback className="bg-muted text-[10px]">
                        {getInitials(actorName)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-row items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                        <span className="text-sm font-medium">{actorName}</span>
                        <span className="text-muted-foreground/60 inline-flex items-center gap-1 text-xs">
                          <span>{action}</span>
                          {!event.status ? (
                            <>
                              <span>{originFromLabel}</span>
                              <ChannelIcon
                                className="text-muted-foreground/50 size-3.5 shrink-0"
                                role="img"
                                aria-label={originFromLabel}
                                data-testid={`origin-icon-${event.id}`}
                              />
                            </>
                          ) : null}
                        </span>
                        {event.status ? (
                          <>
                            <TaskStatusBadge
                              status={event.status}
                              label={tStatus(event.status)}
                              showDot={
                                isLatestStatusEvent && !isStatusOnlyEvent
                              }
                            />
                            <span className="text-muted-foreground/60 inline-flex items-center gap-1 text-xs">
                              <span>{originFromLabel}</span>
                              <ChannelIcon
                                className="text-muted-foreground/50 size-3.5 shrink-0"
                                role="img"
                                aria-label={originFromLabel}
                                data-testid={`origin-icon-${event.id}`}
                              />
                            </span>
                          </>
                        ) : null}
                      </div>
                      <TimeAgo
                        date={event.createdAt}
                        locale={locale}
                        className="text-muted-foreground/40 text-xs whitespace-nowrap"
                      />
                    </div>
                    {formattedComment ? (
                      <ExpandableMarkdown
                        content={formattedComment}
                        className="prose-sm text-foreground/70 text-sm"
                        expandLabel={expandLabel}
                        collapseLabel={collapseLabel}
                        fadeClassName="to-transparent"
                      />
                    ) : null}
                    {shouldShowBillingPlaceholder ? (
                      <p className="text-foreground/70 text-sm">
                        {billingPlaceholderLabel}
                      </p>
                    ) : null}
                    {hasCommentSources ? (
                      <div className="space-y-1.5">
                        <Separator className="my-3" />
                        {sourceFiles.length > 0 ? (
                          <SourcesGrid
                            title={t("sourcesFiles")}
                            blobs={sourceFiles}
                            className="mt-0"
                          />
                        ) : null}
                        {sourceLinks.length > 0 ? (
                          <SourcesGrid
                            title={t("sourcesLinks")}
                            links={sourceLinks}
                            className="mt-0"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {shouldShowAuthenticateButton ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild size="sm" variant="default">
                          <a
                            href={event.authenticationUrl ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("authenticate")}
                          </a>
                        </Button>
                      </div>
                    ) : null}
                    {shouldShowBillingButton ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild size="sm" variant="default">
                          <Link href={billingCtaHref}>{billingCtaLabel}</Link>
                        </Button>
                      </div>
                    ) : null}
                    {shouldShowSecondaryChargeLine ? (
                      <div className="text-muted-foreground/60 text-xs">
                        {chargedLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );

            return isNewOptimisticEvent ? (
              <AnimatedNewRow key={event.id}>{row}</AnimatedNewRow>
            ) : (
              row
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
