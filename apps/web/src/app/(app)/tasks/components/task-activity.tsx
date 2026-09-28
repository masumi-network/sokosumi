"use client";

import {
  formatTaskAttachmentMarkdown,
  type SubscriptionPlanName,
} from "@sokosumi/utils";
import { ArrowUp, Command, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { CHAT_MESSAGE_LIST_ATTRIBUTE } from "@/app/chat/chat-message-list";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import { type TaskActivityActorInfo } from "@/app/tasks/utils/task-activity-actors";
import {
  buildTaskActivityFeedItems,
  getLatestTaskEventId,
  mergeTaskActivityEvents,
  TASK_ACTIVITY_MESSAGE_LIST,
} from "@/app/tasks/utils/task-activity-feed";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { useOSDetection } from "@/hooks/use-os-detection";
import {
  createTaskComment,
  loadOlderTaskActivityEvents,
} from "@/lib/actions/task/action";
import { Channel } from "@/lib/clients/generated/core";
import type {
  TaskEvent,
  TaskFile,
  TaskParticipant,
} from "@/lib/clients/generated/core/types.gen";
import { createFileUploadProgressToast } from "@/lib/utils/file-upload-progress-toast";
import { parseMentions } from "@/lib/utils/mention-parser";
import {
  extractTaskAttachmentUrls,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
} from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import { getUserFileUploadErrorMessage } from "@/lib/utils/user-file-upload.client";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import {
  TaskActivityEventRow,
  type TaskActivityRowContext,
} from "./task-activity-event-row";
import { TaskActivitySubscribeControl } from "./task-activity-subscribe";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";

interface TaskActivityProps {
  taskId: string;
  title: string;
  placeholder: string;
  attachLabel: string;
  submitLabel: string;
  actorCoworkerLabel: string;
  actorUserLabel: string;
  actorSokoBotLabel: string;
  actorSystemLabel: string;
  actionCommentedLabel: string;
  actionUpdatedStatusLabel: string;
  events: TaskEvent[];
  /** Total comment events on the Task (Core meta); drives grouping. */
  commentCount?: number;
  /** Newest comment event id from Core meta; Jump to latest target. */
  latestCommentId?: string | null;
  taskFiles: TaskFile[];
  agentNameById?: Map<string, string>;
  userById?: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  sokoBotById?: Record<string, TaskActivityActorInfo>;
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
  /** Workspace members the composer offers for `@`; mentions add them as Task participants. */
  mentionableUsers?: readonly MentionableUser[];
  /** Task participants in join order. */
  participants?: TaskParticipant[];
}

export interface MentionableUser {
  id: string;
  name: string;
}

const NO_MENTIONABLE_USERS: readonly MentionableUser[] = [];
const NO_PARTICIPANTS: TaskParticipant[] = [];

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
  actorSokoBotLabel,
  actorSystemLabel,
  actionCommentedLabel,
  actionUpdatedStatusLabel,
  events,
  commentCount: commentCountProp,
  latestCommentId: latestCommentIdProp,
  taskFiles,
  agentNameById,
  userById,
  coworkerById,
  sokoBotById,
  currentUser,
  expandLabel = "Expand",
  collapseLabel = "Show less",
  viewerPlan = null,
  canComment = true,
  mentionableUsers = NO_MENTIONABLE_USERS,
  participants = NO_PARTICIPANTS,
}: TaskActivityProps) {
  const t = useTranslations("App.Tasks.Detail");
  const _tStatus = useTranslations("App.Tasks.Filters.statusOptions");
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
  const [, startExpandTransition] = useTransition();
  const [localEvents, setLocalEvents] = useState<TaskEvent[]>(events);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const { os, isMobile } = useOSDetection();
  // Match chat and Core `excludeUserId`: @ of yourself does not enroll the writer.
  const viewerId = currentUser?.id;
  const mentionOptions = useMemo(() => {
    const humans =
      viewerId == null
        ? mentionableUsers
        : mentionableUsers.filter((user) => user.id !== viewerId);
    return {
      ...convertAgentNamesToMentionOptions(resolvedAgentNameById),
      ...Object.fromEntries(
        humans.map((user) => [user.id, { value: user.name }]),
      ),
    };
  }, [resolvedAgentNameById, mentionableUsers, viewerId]);
  const mentionUserNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, actor] of Object.entries(userById ?? {})) {
      names.set(id, actor.name);
    }
    for (const user of mentionableUsers) {
      if (viewerId != null && user.id === viewerId) continue;
      names.set(user.id, user.name);
    }
    return names;
  }, [userById, mentionableUsers, viewerId]);
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(comment),
    [comment],
  );

  useEffect(() => {
    setCommentsExpanded(false);
    setPendingJumpId(null);
  }, [taskId]);

  useEffect(() => {
    // Same task: merge so expanded older pages survive truncated refresh.
    // Drop optimistic rows — the refreshed prop carries the persisted event.
    // Different task: replace the feed entirely.
    setLocalEvents((prev) => {
      const sameTask =
        prev.length > 0 && prev.every((event) => event.taskId === taskId);
      if (!sameTask) {
        return events;
      }
      return mergeTaskActivityEvents(
        prev.filter((event) => !event.id.startsWith("optimistic:")),
        events,
      );
    });
  }, [events, taskId]);

  const abortActiveUploads = useCallback(() => {
    for (const controller of activeUploadControllersRef.current) {
      controller.abort();
    }
    activeUploadControllersRef.current.clear();
  }, []);

  useEffect(() => abortActiveUploads, [abortActiveUploads]);

  const localCommentCount = localEvents.filter(
    (event) => event.comment != null,
  ).length;
  // Prefer live local count when it outruns Core meta (optimistic append).
  const commentCount = Math.max(commentCountProp ?? 0, localCommentCount);
  const latestLocalCommentId =
    [...localEvents]
      .filter((event) => event.comment != null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          b.id.localeCompare(a.id),
      )[0]?.id ?? null;
  const latestCommentId = latestLocalCommentId ?? latestCommentIdProp ?? null;
  const latestEventId = getLatestTaskEventId(localEvents);
  const feedItems = useMemo(
    () =>
      buildTaskActivityFeedItems(localEvents, {
        commentCount,
        commentsExpanded,
      }),
    [localEvents, commentCount, commentsExpanded],
  );
  const rowContext = useMemo<TaskActivityRowContext>(
    () => ({
      actorCoworkerLabel,
      actorUserLabel,
      actorSokoBotLabel,
      actorSystemLabel,
      actionCommentedLabel,
      actionUpdatedStatusLabel,
      expandLabel,
      collapseLabel,
      latestEventId,
      taskFiles,
      agentNameById: resolvedAgentNameById,
      mentionUserNameById,
      userById,
      coworkerById,
      sokoBotById,
      viewerPlan,
    }),
    [
      actorCoworkerLabel,
      actorUserLabel,
      actorSokoBotLabel,
      actorSystemLabel,
      actionCommentedLabel,
      actionUpdatedStatusLabel,
      expandLabel,
      collapseLabel,
      latestEventId,
      taskFiles,
      resolvedAgentNameById,
      mentionUserNameById,
      userById,
      coworkerById,
      sokoBotById,
      viewerPlan,
    ],
  );
  const showJumpToRecent = latestCommentId != null;
  const oldestLoadedCommentId =
    localEvents.find((event) => event.comment != null)?.id ??
    localEvents[0]?.id ??
    null;

  useEffect(() => {
    if (!pendingJumpId) {
      return;
    }
    if (highlightListMessage(TASK_ACTIVITY_MESSAGE_LIST, pendingJumpId)) {
      setPendingJumpId(null);
    }
  }, [pendingJumpId, localEvents, commentsExpanded, feedItems]);

  const trimmedComment = comment.trim();
  const isUploadingAttachments = uploadingAttachmentsCount > 0;
  const isSubmitDisabled =
    !canComment ||
    isPending ||
    trimmedComment.length === 0 ||
    !currentUser?.id ||
    isUploadingAttachments;

  function handleJumpToRecent() {
    if (!latestCommentId) {
      return;
    }
    if (highlightListMessage(TASK_ACTIVITY_MESSAGE_LIST, latestCommentId)) {
      return;
    }
    startExpandTransition(() => {
      void (async () => {
        if (oldestLoadedCommentId) {
          const result = await loadOlderTaskActivityEvents({
            taskId,
            untilEventId: oldestLoadedCommentId,
          });
          if (result.ok) {
            setLocalEvents((prev) =>
              mergeTaskActivityEvents(prev, result.value),
            );
            setCommentsExpanded(true);
          }
        } else {
          setCommentsExpanded(true);
        }
        setPendingJumpId(latestCommentId);
      })();
    });
  }

  function handleExpandOlderComments() {
    if (commentsExpanded) {
      return;
    }
    const needsOlderPages =
      oldestLoadedCommentId != null && commentCount > localCommentCount;

    if (!needsOlderPages) {
      setCommentsExpanded(true);
      return;
    }

    startExpandTransition(() => {
      void (async () => {
        const result = await loadOlderTaskActivityEvents({
          taskId,
          untilEventId: oldestLoadedCommentId,
        });
        if (!result.ok) {
          return;
        }
        setLocalEvents((prev) => mergeTaskActivityEvents(prev, result.value));
        setCommentsExpanded(true);
      })();
    });
  }

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

    const memberIds = new Set(
      mentionableUsers
        .filter((user) => viewerId == null || user.id !== viewerId)
        .map((user) => user.id),
    );
    const mentionedUserIds = [
      ...new Set(
        parseMentions(trimmedComment)
          .map((mention) => mention.id)
          .filter((id) => memberIds.has(id)),
      ),
    ];

    setLocalEvents((prev) => [...prev, optimisticEvent]);
    setComment("");

    startTransition(() => {
      void (async () => {
        try {
          await createTaskComment({
            taskId,
            comment: trimmedComment,
            mentionedUserIds,
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

    const uploadToast = createFileUploadProgressToast({
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
        const uploadedUrl = await uploadTaskAttachment(taskId, file, {
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
      router.refresh();
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
        <TaskActivitySubscribeControl
          taskId={taskId}
          viewerId={currentUser?.id ?? null}
          viewerName={currentUser?.name ?? null}
          viewerImage={currentUser?.image ?? null}
          participants={participants}
          canComment={canComment}
        />
      </div>

      {showJumpToRecent ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="h-7 rounded-full px-3 text-xs font-semibold"
            onClick={handleJumpToRecent}
          >
            {t("jumpToRecent")}
          </Button>
        </div>
      ) : null}

      {feedItems.length > 0 ? (
        <div
          className="space-y-3"
          {...{ [CHAT_MESSAGE_LIST_ATTRIBUTE]: TASK_ACTIVITY_MESSAGE_LIST }}
        >
          {feedItems.map((item) => {
            if (item.type === "comment-group") {
              return (
                <div key="comment-group" className="flex justify-center py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={handleExpandOlderComments}
                  >
                    {t("showOlderComments", { count: item.hiddenCount })}
                  </Button>
                </div>
              );
            }

            const event = item.event;
            const row = (
              <TaskActivityEventRow
                key={event.id}
                event={event}
                context={rowContext}
              />
            );

            return isNewOptimisticEventId(event.id) ? (
              <AnimatedNewRow key={event.id}>{row}</AnimatedNewRow>
            ) : (
              row
            );
          })}
        </div>
      ) : null}

      {canComment ? (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="border-border rounded-lg border p-3"
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
              className="data-dragging:bg-card-background w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
              onClick={(event) => event.preventDefault()}
            >
              <MarkdownEditor
                ref={markdownEditorRef}
                placeholder={placeholder}
                className="border-border bg-senary w-full rounded-lg border"
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
    </section>
  );
}
