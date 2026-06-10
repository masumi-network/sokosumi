"use client";

import { TaskStatus } from "@sokosumi/utils";
import { ArrowLeft, Command, CornerDownLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { CoworkerCard } from "@/app/tasks/new/components/coworker-card";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import {
  readCreateTaskModalLastCoworkerId,
  writeCreateTaskModalLastCoworkerId,
} from "@/app/tasks/utils/create-task-modal-preferences";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOSDetection } from "@/hooks/use-os-detection";
import { createTask, updateTask } from "@/lib/actions/task/action";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import {
  createDesignMdDismissedState,
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  isDesignMdAttachmentSkipped,
  markDesignMdDismissed,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
  seedTaskDescriptionWithDesignMd,
  syncDesignMdDismissedState,
  type TaskDesignMdAttachmentSeed,
} from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import { DEFAULT_TASK_NAME_MAX_LENGTH } from "@/lib/utils/task-transformer";
import { getUserFileUploadErrorMessage } from "@/lib/utils/user-file-upload.client";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { createTaskAttachmentUploadToast } from "./task-attachment-upload-toast";
import { TaskProjectSelect } from "./task-project-select";

const EMPTY_AGENT_NAME_MAP = new Map<string, string>();

export interface TaskFormLabels {
  details: string;
  detailsDescription: string;
  name: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  projectLabel: string;
  projectNone: string;
  projectSearchPlaceholder: string;
  projectEmptyResults: string;
  coworker: string;
  coworkerDescription: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusReady: string;
  markAsReady?: string;
  revertToDraft?: string;
  back: string;
  uploadFile: string;
  uploadFileError?: string;
  uploadingFile: string;
  uploadingFiles: string;
  removeAttachment?: string;
  submit: string;
  saveAsDraft?: string;
  createTask?: string;
  cancel: string;
  ctrl: string;
}

interface TaskFormInitialValues {
  name?: string;
  description?: string;
  coworkerId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
}

export type TaskFormInitialDesignMdAttachment = TaskDesignMdAttachmentSeed;

interface TaskFormProps {
  mode: "create" | "edit";
  labels: TaskFormLabels;
  coworkerOptions: CoworkerOption[];
  agentNameById?: Map<string, string>;
  taskId?: string;
  initialValues?: TaskFormInitialValues;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  projectOptions?: ProjectFilterOption[];
  defaultProjectId?: string | null;
  variant?: "page" | "modal";
  onCancel?: () => void;
  onSuccess?: (taskId: string) => void;
  onCreateTask?: (input: {
    description: string;
    coworkerId: string | null;
    projectId?: string | null;
    skipDesignMdAttachment?: boolean;
    status: Extract<TaskStatus, "DRAFT" | "READY">;
  }) => Promise<{ taskId: string }>;
  showCancel?: boolean;
  onSubmittingChange?: (isSubmitting: boolean) => void;
}

export function TaskForm({
  mode,
  labels,
  coworkerOptions,
  agentNameById = EMPTY_AGENT_NAME_MAP,
  taskId,
  initialValues,
  initialDesignMdAttachment,
  projectOptions,
  defaultProjectId = null,
  variant = "page",
  onCancel,
  onSuccess,
  onCreateTask,
  showCancel = true,
  onSubmittingChange,
}: TaskFormProps) {
  const router = useRouter();
  const isModal = variant === "modal";
  const shouldShowProjectSelect = isModal && projectOptions !== undefined;
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(() =>
    getInitialDescription({
      attachment: initialDesignMdAttachment,
      description: initialValues?.description,
      mode,
    }),
  );
  const [projectId, setProjectId] = useState<string | null>(
    initialValues?.projectId ?? defaultProjectId ?? null,
  );
  const hasExplicitInitialCoworker =
    initialValues?.coworkerId != null && initialValues.coworkerId !== "";
  const defaultCoworkerId = useMemo(() => {
    const elenaCoworker = coworkerOptions.find(
      (option) => option.slug === "elena",
    );

    return (
      initialValues?.coworkerId ??
      elenaCoworker?.id ??
      coworkerOptions[0]?.id ??
      ""
    );
  }, [coworkerOptions, initialValues?.coworkerId]);

  const coworkerTouchedRef = useRef(false);
  const [coworkerId, setCoworkerId] = useState(defaultCoworkerId);

  useLayoutEffect(() => {
    if (coworkerTouchedRef.current) return;
    setCoworkerId(defaultCoworkerId);
  }, [defaultCoworkerId]);

  useEffect(() => {
    if (!isModal || mode !== "create" || hasExplicitInitialCoworker) return;
    if (coworkerTouchedRef.current) return;

    const stored = readCreateTaskModalLastCoworkerId();
    if (stored && coworkerOptions.some((option) => option.id === stored)) {
      setCoworkerId(stored);
    }
  }, [coworkerOptions, hasExplicitInitialCoworker, isModal, mode]);

  const [status, setStatus] = useState<TaskStatus>(originalStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [uploadingAttachmentsCount, setUploadingAttachmentsCount] = useState(0);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const activeUploadControllersRef = useRef(new Set<AbortController>());
  const designMdStateRef = useRef(createDesignMdDismissedState());
  syncDesignMdDismissedState(
    description,
    initialDesignMdAttachment,
    designMdStateRef.current,
  );
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(description),
    [description],
  );
  const mentionOptions = useMemo(
    () => convertAgentNamesToMentionOptions(agentNameById),
    [agentNameById],
  );
  const isSubmittingAny = isSubmitting || isSubmittingDraft;
  useEffect(() => {
    onSubmittingChange?.(isSubmittingAny);
  }, [isSubmittingAny, onSubmittingChange]);

  const handleCoworkerSelect = useCallback(
    (id: string) => {
      coworkerTouchedRef.current = true;
      setCoworkerId(id);
      if (isModal && mode === "create") {
        writeCreateTaskModalLastCoworkerId(id);
      }
    },
    [isModal, mode],
  );

  const abortActiveUploads = useCallback(() => {
    for (const controller of activeUploadControllersRef.current) {
      controller.abort();
    }
    activeUploadControllersRef.current.clear();
  }, []);

  useEffect(() => abortActiveUploads, [abortActiveUploads]);

  const { os, isMobile } = useOSDetection();

  const isNameRequired = mode === "edit";
  const isUploadingAttachments = uploadingAttachmentsCount > 0;
  const isSaveDisabled =
    !description.trim() ||
    (isNameRequired && !name.trim()) ||
    isSubmittingAny ||
    isUploadingAttachments;
  const shouldShowEditToggle = mode === "edit";
  const statusToggleLabel =
    status === TaskStatus.DRAFT
      ? (labels.markAsReady ?? labels.statusReady)
      : (labels.revertToDraft ?? labels.statusDraft);

  const handleSave = useCallback(
    async (overrideStatus?: TaskStatus) => {
      if (isSaveDisabled) return;
      if (overrideStatus && overrideStatus === TaskStatus.DRAFT) {
        setIsSubmittingDraft(true);
      } else {
        setIsSubmitting(true);
      }
      try {
        const trimmedDescription = description.trim();
        const desiredStatus = overrideStatus ?? status;
        if (mode === "create" && ["DRAFT", "READY"].includes(desiredStatus)) {
          const createTaskHandler = onCreateTask ?? createTask;
          const result = await createTaskHandler({
            description: trimmedDescription,
            coworkerId,
            skipDesignMdAttachment: isDesignMdAttachmentSkipped(
              designMdStateRef.current,
            ),
            ...(shouldShowProjectSelect ? { projectId } : {}),
            status: desiredStatus as Extract<TaskStatus, "DRAFT" | "READY">,
          });
          if (onSuccess) {
            onSuccess(result.taskId);
            return;
          }
          router.push(`/tasks/${result.taskId}`);
          return;
        }

        if (!taskId) {
          throw new Error("Task ID is required");
        }

        const trimmedName = name.trim();
        await updateTask({
          taskId,
          name: trimmedName,
          description: trimmedDescription,
          coworkerId,
          ...(shouldShowProjectSelect ? { projectId } : {}),
          currentStatus: originalStatus,
          desiredStatus,
        });
        if (onSuccess) {
          onSuccess(taskId);
          return;
        }
        router.push(`/tasks/${taskId}`);
      } catch (error) {
        console.error("Failed to save task", error);
        toast.error("Failed to save task");
      } finally {
        setIsSubmitting(false);
        setIsSubmittingDraft(false);
      }
    },
    [
      description,
      isSaveDisabled,
      mode,
      name,
      coworkerId,
      projectId,
      shouldShowProjectSelect,
      originalStatus,
      router,
      status,
      taskId,
      onSuccess,
      onCreateTask,
    ],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !isSaveDisabled
      ) {
        event.preventDefault();
        const shortcutStatus = mode === "create" ? TaskStatus.READY : undefined;
        void handleSave(shortcutStatus);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isSaveDisabled, mode]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const uploadToast = createTaskAttachmentUploadToast({
        files,
        labels: {
          uploadingFile: labels.uploadingFile,
          uploadingFiles: labels.uploadingFiles,
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
          const safeName = sanitizeTaskAttachmentLabel(file.name, "file");
          if (markdownEditorRef.current) {
            markdownEditorRef.current.insertLink(safeName, uploadedUrl);
            markdownEditorRef.current.insertText("\n");
            continue;
          }
          const markdownLink = formatTaskAttachmentMarkdown(
            safeName,
            uploadedUrl,
          );
          setDescription(
            (prev) =>
              `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
          );
        }
        uploadToast.dismiss();
      } catch (error) {
        uploadToast.dismiss();
        toast.error(
          getUserFileUploadErrorMessage(
            error,
            labels.uploadFileError ?? "Failed to upload file",
          ),
        );
      } finally {
        activeUploadControllersRef.current.delete(controller);
        setPendingUploadFiles([]);
        setUploadingAttachmentsCount((count) => count - 1);
      }
    },
    [labels.uploadFileError, labels.uploadingFile, labels.uploadingFiles],
  );

  const handleRemoveAttachment = useCallback(
    (url: string) => {
      if (initialDesignMdAttachment?.url === url) {
        markDesignMdDismissed(designMdStateRef.current);
      }
      setDescription((prev) => removeTaskAttachmentLinks(prev, [url]));
    },
    [initialDesignMdAttachment?.url],
  );

  const handleCancel = () => {
    abortActiveUploads();
    if (onCancel) {
      onCancel();
      return;
    }
    if (mode === "edit" && taskId) {
      router.push(`/tasks/${taskId}`);
      return;
    }
    router.push("/tasks");
  };

  return (
    <div className={isModal ? "space-y-6" : "max-w-3xl space-y-6"}>
      {!isModal ? (
        <header className="flex items-center gap-2">
          <Link href="/tasks" aria-label={labels.back}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={labels.back}
            >
              <ArrowLeft className="size-4" />
              <span className="sr-only">{labels.back}</span>
            </Button>
          </Link>
        </header>
      ) : null}

      <section className={isModal ? "space-y-0" : "rounded-xl border"}>
        {!isModal ? (
          <div className="space-y-1 p-6">
            <h2 className="text-lg font-semibold">{labels.details}</h2>
            <p className="text-muted-foreground text-sm">
              {labels.detailsDescription}
            </p>
          </div>
        ) : null}

        <div
          className={
            isModal ? "space-y-4 px-6 py-5" : "space-y-4 border-t px-6 py-6"
          }
        >
          {mode === "edit" ? (
            <div className="space-y-2">
              <Label htmlFor="task-name">{labels.name}</Label>
              <Input
                id="task-name"
                maxLength={DEFAULT_TASK_NAME_MAX_LENGTH}
                placeholder={labels.namePlaceholder}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          ) : null}

          {shouldShowProjectSelect ? (
            <div className="space-y-2">
              <Label>{labels.projectLabel}</Label>
              <TaskProjectSelect
                projectOptions={projectOptions ?? []}
                value={projectId}
                onChange={setProjectId}
                projectLabel={labels.projectLabel}
                noneLabel={labels.projectNone}
                searchPlaceholder={labels.projectSearchPlaceholder}
                emptyResults={labels.projectEmptyResults}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="task-description">{labels.details}</Label>
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
                  id="task-description"
                  placeholder={labels.descriptionPlaceholder}
                  className="w-full"
                  value={description}
                  onChange={setDescription}
                  onSubmitShortcut={() => {
                    const shortcutStatus =
                      mode === "create" ? TaskStatus.READY : undefined;
                    void handleSave(shortcutStatus);
                  }}
                  onAttachClick={() => attachmentTriggerRef.current?.click()}
                  attachLabel={labels.uploadFile}
                  isAttachmentUploading={isUploadingAttachments}
                  mentions={mentionOptions}
                />
                <FileUploadTrigger asChild>
                  <button
                    ref={attachmentTriggerRef}
                    type="button"
                    className="sr-only"
                    aria-label={labels.uploadFile}
                  >
                    {labels.uploadFile}
                  </button>
                </FileUploadTrigger>
              </FileUploadDropzone>
            </FileUpload>
            {attachmentUrls.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {attachmentUrls.map((url) => (
                  <FileChipMiniPreviewWithMetadata
                    key={url}
                    url={url}
                    onRemove={() => handleRemoveAttachment(url)}
                    removeLabel={labels.removeAttachment ?? labels.cancel}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className={isModal ? "border-t px-6 py-5" : "border-t px-6 py-6"}>
          <div className="space-y-3">
            <Label className="text-sm font-medium">{labels.coworker}</Label>
            <div className={cn("max-h-[264px] overflow-y-auto pr-1")}>
              <div className="grid grid-cols-2 gap-2">
                {coworkerOptions.map((option) => (
                  <CoworkerCard
                    key={option.id}
                    option={option}
                    isSelected={coworkerId === option.id}
                    onSelect={() => handleCoworkerSelect(option.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          className={
            isModal
              ? "flex flex-col items-stretch justify-end gap-3 border-t px-6 py-4 sm:flex-row sm:items-center"
              : "flex flex-col items-stretch justify-end gap-3 border-t px-6 py-6 sm:flex-row sm:items-center"
          }
        >
          <div className="flex items-center gap-3">
            {mode === "create" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaveDisabled}
                  onClick={() => handleSave(TaskStatus.DRAFT)}
                >
                  {isSubmittingDraft ? (
                    <Loader2
                      className="mr-1.5 h-3.5 w-3.5 animate-spin"
                      aria-hidden
                    />
                  ) : null}
                  {labels.saveAsDraft ?? labels.submit}
                </Button>
                <Button
                  type="button"
                  disabled={isSaveDisabled}
                  onClick={() => handleSave(TaskStatus.READY)}
                >
                  <div className="flex items-center gap-1.5">
                    {isSubmitting ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    {labels.createTask ?? labels.submit}
                    {!isMobile ? (
                      <div className="flex items-center gap-0.5 opacity-60">
                        {os === "MacOS" ? (
                          <Command className="size-3" />
                        ) : (
                          <span className="text-xs">{labels.ctrl}</span>
                        )}
                        <CornerDownLeft className="size-3" />
                      </div>
                    ) : null}
                  </div>
                </Button>
              </>
            ) : (
              <>
                {shouldShowEditToggle ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-28"
                    onClick={() =>
                      setStatus((current) =>
                        current === TaskStatus.DRAFT
                          ? TaskStatus.READY
                          : TaskStatus.DRAFT,
                      )
                    }
                    disabled={isSubmitting}
                  >
                    {statusToggleLabel}
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  className="min-w-28 items-center justify-between gap-1"
                  disabled={isSaveDisabled}
                  onClick={() => handleSave()}
                >
                  <div className="flex items-center gap-2">
                    {isSubmitting ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden
                      />
                    ) : null}
                    {labels.submit}
                    {!isMobile ? (
                      <div className="flex items-center gap-1">
                        {os === "MacOS" ? <Command /> : labels.ctrl}
                        <CornerDownLeft />
                      </div>
                    ) : null}
                  </div>
                </Button>
              </>
            )}
            {showCancel ? (
              <Button
                type="button"
                variant="outline"
                className="min-w-24"
                onClick={handleCancel}
              >
                {labels.cancel}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function getInitialDescription({
  attachment,
  description,
  mode,
}: {
  attachment?: TaskFormInitialDesignMdAttachment | null;
  description?: string;
  mode: "create" | "edit";
}): string {
  if (mode !== "create") {
    return description ?? "";
  }

  return seedTaskDescriptionWithDesignMd(description ?? "", attachment);
}
