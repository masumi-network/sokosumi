"use client";

import {
  ArrowLeft,
  CalendarClock,
  Command,
  CornerDownLeft,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { AgentDetail } from "@/app/tasks/new/components/agent-detail";
import { AgentSpotlight } from "@/app/tasks/new/components/agent-spotlight";
import { CoworkerCard } from "@/app/tasks/new/components/coworker-card";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { VendorMark } from "@/components/agents/vendor-mark";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { formatTaskScheduleSelectionLabel } from "@/components/schedules/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { TaskStatus } from "@/lib/clients/generated/core";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
import { getScheduleIcon } from "@/lib/utils/schedule-icon";
import {
  createDesignMdDismissedState,
  ensureDesignMdInDescription,
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
import { metadataToSelection } from "@/lib/utils/task-schedule";
import {
  getUserFileUploadErrorMessage,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { createTaskAttachmentUploadToast } from "./task-attachment-upload-toast";
import { TaskCreatedCelebration } from "./task-created-celebration";
import { TaskFormModalHeaderStart } from "./task-form-modal";
import { TaskProjectSelect } from "./task-project-select";
import { TaskScheduleModal } from "./task-schedule-modal";

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
  projectCreate?: string;
  projectCreateNamed?: string;
  coworker: string;
  coworkerDescription: string;
  chooseAgent?: string;
  chooseAgentDescription?: string;
  defaultBadge?: string;
  modelLabel?: string;
  hostingLabel?: string;
  examplesTitle?: string;
  continueLabel?: string;
  taskStepTitle?: string;
  previousLabel?: string;
  nextLabel?: string;
  searchPlaceholder?: string;
  noResults?: string;
  askPrompt?: string;
  promptHint?: string;
  tasksTitle?: string;
  startFromScratch?: string;
  startFromScratchHint?: string;
  previewExample?: string;
  previewUse?: string;
  previewEmpty?: string;
  allCompanies?: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusQueued?: string;
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
  scheduleTask?: string;
  openSchedule: string;
  cancel: string;
  ctrl: string;
  taskCreated?: string;
  taskCreatedHint?: string;
  goToTask?: string;
  createAnother?: string;
}

interface TaskFormInitialValues {
  name?: string;
  description?: string;
  assigneeId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
  metadata?: string | null;
  nextRunAt?: string | null;
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
  /** Runs right after a modal create succeeds (before the celebration step). */
  onCreated?: (taskId: string) => void;
  onCreateAnother?: () => void;
  onCreateTask?: (input: {
    description: string;
    assigneeId: string | null;
    projectId?: string | null;
    skipDesignMdAttachment?: boolean;
    status: Extract<TaskStatus, "DRAFT" | "READY">;
    schedule?: TaskScheduleSelection;
  }) => Promise<{ taskId: string; name?: string }>;
  showCancel?: boolean;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  onCreatedChange?: (created: boolean) => void;
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
  onCreated,
  onCreateAnother,
  onCreateTask,
  showCancel = true,
  onSubmittingChange,
  onCreatedChange,
}: TaskFormProps) {
  const router = useRouter();
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();
  const isModal = variant === "modal";
  const shouldShowProjectSelect = isModal && projectOptions !== undefined;
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  const [name, setName] = useState(initialValues?.name ?? "");
  const initialDescription = useMemo(
    () =>
      getInitialDescription({
        attachment: initialDesignMdAttachment,
        description: initialValues?.description,
        mode,
      }),
    [initialDesignMdAttachment, initialValues?.description, mode],
  );
  const [description, setDescription] = useState(initialDescription);
  const [projectId, setProjectId] = useState<string | null>(
    initialValues?.projectId ?? defaultProjectId ?? null,
  );
  const [inlineCreatedProjects, setInlineCreatedProjects] = useState<
    ProjectFilterOption[]
  >([]);
  const localProjectOptions = useMemo(() => {
    const parentOptions = projectOptions ?? [];
    const parentIds = new Set(parentOptions.map((project) => project.id));
    const localOnly = inlineCreatedProjects.filter(
      (project) => !parentIds.has(project.id),
    );

    return [...parentOptions, ...localOnly];
  }, [inlineCreatedProjects, projectOptions]);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const [createProjectQuery, setCreateProjectQuery] = useState("");
  const defaultAssigneeId = useMemo(() => {
    // Default to Elena on first open. Match by slug or name (case-insensitive)
    // so it works across environments (dev seed + mainnet) where the slug may
    // differ; fall back to the highest-priority coworker.
    const elenaCoworker = coworkerOptions.find(
      (option) =>
        option.slug.trim().toLowerCase() === "elena" ||
        option.name.trim().toLowerCase() === "elena",
    );

    return (
      initialValues?.assigneeId ??
      elenaCoworker?.id ??
      coworkerOptions[0]?.id ??
      ""
    );
  }, [coworkerOptions, initialValues?.assigneeId]);

  const coworkerTouchedRef = useRef(false);
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);

  useLayoutEffect(() => {
    if (coworkerTouchedRef.current) return;
    setAssigneeId(defaultAssigneeId);
  }, [defaultAssigneeId]);

  const [status, setStatus] = useState<TaskStatus>(originalStatus);
  const [scheduleSelection, setScheduleSelection] =
    useState<TaskScheduleSelection>(() =>
      metadataToSelection(initialValues?.metadata, getDefaultTimezone()),
    );
  const originalScheduleSelection = useRef(scheduleSelection);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const hadSchedule = useMemo(
    () =>
      Boolean(
        initialValues?.metadata ||
          (initialValues?.nextRunAt && initialValues.nextRunAt.length > 0),
      ),
    [initialValues?.metadata, initialValues?.nextRunAt],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingDraft, setIsSubmittingDraft] = useState(false);
  const [createdTask, setCreatedTask] = useState<{
    id: string;
    name: string;
    status: "DRAFT" | "QUEUED" | "READY";
    statusLabel: string;
    scheduleLabel?: string;
  } | null>(null);
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
    onCreatedChange?.(createdTask !== null);
  }, [createdTask, onCreatedChange]);

  const handleCoworkerSelect = useCallback((id: string) => {
    coworkerTouchedRef.current = true;
    setAssigneeId(id);
  }, []);

  const handleCreateProject = useCallback((searchQuery: string) => {
    setCreateProjectQuery(searchQuery);
    setIsCreateProjectModalOpen(true);
  }, []);

  const handleProjectCreated = useCallback(
    (result: { projectId: string; name: string }) => {
      const newProject: ProjectFilterOption = {
        id: result.projectId,
        name: result.name,
      };
      setInlineCreatedProjects((prev) => [...prev, newProject]);
      setProjectId(result.projectId);
    },
    [],
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
  const hasSchedule = scheduleSelection.mode !== "none";
  const ScheduleFooterIcon = hasSchedule
    ? getScheduleIcon(
        scheduleSelection.mode === "recurring" ? "recurring" : "once",
      )
    : null;
  const scheduleLabel = useMemo(
    () =>
      formatTaskScheduleSelectionLabel(
        scheduleSelection,
        (key, values) =>
          tSchedule(
            key as
              | "option.oneTime"
              | "option.custom"
              | "option.dailyWithTime"
              | "option.weeklyWithWeekdayTime"
              | "option.monthlyWithDayTime"
              | "option.dailyEveryNWithTime"
              | "option.weeklyListWithTime"
              | "option.monthlyEveryNWithDayTime"
              | "footer.oneTimeAt",
            values as Record<string, string | number | Date>,
          ),
        formatter,
      ),
    [formatter, scheduleSelection, tSchedule],
  );
  useEffect(() => {
    onSubmittingChange?.(isSubmittingAny || isUploadingAttachments);
  }, [isSubmittingAny, isUploadingAttachments, onSubmittingChange]);
  const isSaveDisabled =
    createdTask !== null ||
    !description.trim() ||
    (isNameRequired && !name.trim()) ||
    isSubmittingAny ||
    isUploadingAttachments;

  // Two-step create flow: 1 = spotlight (pick a coworker + a ready-to-run task,
  // or start from scratch), 2 = compose. Skip the wizard only when a coworker
  // is prefilled (gallery offer, agents-page deep link). A prompt alone does not
  // skip step 1 — otherwise a bad coworker slug would land on compose with the
  // default assignee.
  const hasPrefilledAssignee = Boolean(initialValues?.assigneeId);
  const useWizard = isModal && mode === "create" && !hasPrefilledAssignee;
  const [step, setStep] = useState<1 | 2>(hasPrefilledAssignee ? 2 : 1);
  const showTaskStep = !useWizard || step === 2;
  const showCoworkerGrid = mode === "create" && !isModal;
  const useComposeLayout = isModal && mode === "create" && showTaskStep;
  const useModalShellLayout = isModal;
  const useModalScrollFill = isModal;
  const useModalFieldFill = isModal && showTaskStep;
  const canUseSubmitShortcut =
    showTaskStep && !isSaveDisabled && !isCreateProjectModalOpen;
  const taskStepTitle = labels.taskStepTitle ?? "What should {name} do?";
  const shouldShowEditToggle = mode === "edit";
  const canMarkAsReady = !hasSchedule;
  const statusToggleLabel =
    status === TaskStatus.DRAFT
      ? (labels.markAsReady ?? labels.statusReady)
      : (labels.revertToDraft ?? labels.statusDraft);
  const isStatusToggleDisabled =
    isSubmitting || (status === TaskStatus.DRAFT && !canMarkAsReady);

  function handleStatusToggle() {
    setStatus((current) => {
      if (current === TaskStatus.DRAFT) {
        return canMarkAsReady ? TaskStatus.READY : current;
      }
      return TaskStatus.DRAFT;
    });
  }

  const handleSave = useCallback(
    async (overrideStatus?: TaskStatus) => {
      if (isSaveDisabled || (useWizard && step === 1)) return;
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
            assigneeId,
            skipDesignMdAttachment: isDesignMdAttachmentSkipped(
              designMdStateRef.current,
            ),
            ...(shouldShowProjectSelect ? { projectId } : {}),
            status: desiredStatus as Extract<TaskStatus, "DRAFT" | "READY">,
            schedule: scheduleSelection,
          });
          // In the modal, confirm success in place and let the user choose when
          // to navigate — the redirect target is prefetched so it lands fast.
          if (isModal) {
            const createdStatus =
              scheduleSelection.mode !== "none" &&
              desiredStatus !== TaskStatus.DRAFT
                ? "QUEUED"
                : desiredStatus === TaskStatus.DRAFT
                  ? "DRAFT"
                  : "READY";
            router.prefetch(`/tasks/${result.taskId}`);
            setCreatedTask({
              id: result.taskId,
              name: result.name?.trim() || "Untitled task",
              status: createdStatus,
              statusLabel:
                createdStatus === "QUEUED"
                  ? (labels.statusQueued ?? "Queued")
                  : createdStatus === "DRAFT"
                    ? labels.statusDraft
                    : labels.statusReady,
              scheduleLabel:
                createdStatus === "QUEUED"
                  ? (scheduleLabel ?? undefined)
                  : undefined,
            });
            onCreated?.(result.taskId);
            return;
          }
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
          assigneeId,
          ...(shouldShowProjectSelect ? { projectId } : {}),
          currentStatus: originalStatus,
          desiredStatus,
          schedule: scheduleSelection,
          hadSchedule,
          originalSchedule: originalScheduleSelection.current,
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
      isModal,
      isSaveDisabled,
      mode,
      step,
      useWizard,
      name,
      assigneeId,
      projectId,
      shouldShowProjectSelect,
      originalStatus,
      router,
      status,
      taskId,
      onSuccess,
      onCreated,
      onCreateTask,
      scheduleSelection,
      scheduleLabel,
      hadSchedule,
      labels.statusDraft,
      labels.statusQueued,
      labels.statusReady,
    ],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        canUseSubmitShortcut
      ) {
        event.preventDefault();
        const shortcutStatus = mode === "create" ? TaskStatus.READY : undefined;
        void handleSave(shortcutStatus);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUseSubmitShortcut, handleSave, mode]);

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
          // Existing tasks use task-scoped Blob uploads. New-task create has no
          // taskId yet, so fall back to user-file uploads (pre-#3469 behavior)
          // so description links still work before save.
          const uploadedUrl = taskId
            ? await uploadTaskAttachment(taskId, file, {
                abortSignal: controller.signal,
                onUploadProgress: (progress) => {
                  uploadToast.updateFileProgress(index, progress);
                },
              })
            : (
                await uploadUserFileDirect(file, {
                  abortSignal: controller.signal,
                  onUploadProgress: (progress) => {
                    uploadToast.updateFileProgress(index, progress);
                  },
                })
              ).publicUrl;
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
    [
      labels.uploadFileError,
      labels.uploadingFile,
      labels.uploadingFiles,
      taskId,
    ],
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

  const selectedOption = useMemo(
    () => coworkerOptions.find((option) => option.id === assigneeId),
    [coworkerOptions, assigneeId],
  );
  const showModalCoworkerHeader =
    selectedOption !== undefined &&
    (useComposeLayout || (isModal && mode === "edit"));
  const taskFieldsBorder =
    showModalCoworkerHeader || !isModal ? "border-t" : "";
  const cardLabels = useMemo(
    () => ({
      defaultBadge: labels.defaultBadge ?? "Default",
      modelLabel: labels.modelLabel ?? "Model",
      hostingLabel: labels.hostingLabel ?? "Hosting",
    }),
    [labels.defaultBadge, labels.modelLabel, labels.hostingLabel],
  );
  const chooseAgentLabel = labels.chooseAgent ?? labels.coworker;
  const examplesTitle = labels.examplesTitle ?? "What {name} can do";

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

  function handleClearSchedule() {
    setScheduleSelection({
      mode: "none",
      timezone: scheduleSelection.timezone,
    });
  }

  const handleGoToTask = () => {
    if (!createdTask) return;
    if (onSuccess) {
      onSuccess(createdTask.id);
      return;
    }
    router.push(`/tasks/${createdTask.id}`);
  };

  if (createdTask) {
    return (
      <TaskCreatedCelebration
        name={createdTask.name}
        status={createdTask.status}
        statusLabel={createdTask.statusLabel}
        scheduleLabel={createdTask.scheduleLabel}
        labels={{
          taskCreated: labels.taskCreated ?? "Task created",
          taskCreatedHint: labels.taskCreatedHint,
          goToTask: labels.goToTask ?? "Bring me to the task",
          createAnother: labels.createAnother,
        }}
        onGoToTask={handleGoToTask}
        onCreateAnother={onCreateAnother}
      />
    );
  }

  return (
    <div
      className={
        useModalShellLayout
          ? "flex min-h-0 flex-1 flex-col"
          : "max-w-3xl space-y-6"
      }
    >
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

      <section
        className={
          useModalShellLayout
            ? "flex min-h-0 flex-1 flex-col"
            : "rounded-xl border"
        }
      >
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
            useModalShellLayout
              ? cn(
                  "[&::-webkit-scrollbar-thumb]:bg-border/80 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                  useModalScrollFill && "flex flex-1 flex-col",
                )
              : "contents"
          }
        >
          {useWizard && step === 1 ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8">
              <AgentSpotlight
                options={coworkerOptions}
                selectedId={assigneeId}
                onSelect={handleCoworkerSelect}
                onPickOffer={(offer) => {
                  setDescription(
                    ensureDesignMdInDescription(
                      offer.prompt,
                      initialDesignMdAttachment,
                    ),
                  );
                  setStep(2);
                }}
                onStartFromScratch={() => {
                  setDescription(initialDescription);
                  setStep(2);
                }}
                labels={{
                  defaultBadge: cardLabels.defaultBadge,
                  modelLabel: cardLabels.modelLabel,
                  hostingLabel: cardLabels.hostingLabel,
                  tasksTitle: labels.tasksTitle ?? "Ready-To-Run Tasks",
                  startFromScratch:
                    labels.startFromScratch ?? "Start from scratch",
                  startFromScratchHint:
                    labels.startFromScratchHint ??
                    "Write your own instructions",
                  previewExample: labels.previewExample ?? "Preview example",
                  previewUse: labels.previewUse ?? "Use this task",
                  previewEmpty:
                    labels.previewEmpty ?? "No example output available yet.",
                  noResults: labels.noResults ?? "No agents found.",
                }}
              />
            </div>
          ) : null}

          {useWizard && step === 2 ? (
            <TaskFormModalHeaderStart>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary -ml-2"
                onClick={() => {
                  setIsCreateProjectModalOpen(false);
                  setStep(1);
                }}
              >
                <ArrowLeft className="mr-1 size-3.5" />
                {labels.back}
              </Button>
            </TaskFormModalHeaderStart>
          ) : null}

          {showModalCoworkerHeader ? (
            <div className="flex items-center gap-3 px-6 py-4 md:px-8">
              <Avatar className="ring-border size-9 shrink-0 rounded-full ring-1">
                <AvatarImage
                  src={selectedOption.image}
                  alt={selectedOption.name}
                  className="object-cover"
                />
                <AvatarFallback className="rounded-full text-xs font-medium">
                  {selectedOption.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-tight font-semibold">
                  {selectedOption.name}
                </p>
                {selectedOption.caption ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {selectedOption.caption}
                  </p>
                ) : null}
              </div>
              <VendorMark
                vendor={selectedOption.vendor}
                className="h-5 shrink-0"
                textClassName="text-muted-foreground shrink-0 text-xs font-medium"
              />
            </div>
          ) : null}

          {showTaskStep ? (
            <div
              className={cn(
                "space-y-4 px-6 py-5 md:px-8",
                taskFieldsBorder,
                useModalFieldFill && "flex min-h-0 flex-1 flex-col",
              )}
            >
              {useComposeLayout && selectedOption ? (
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">
                    {taskStepTitle.replace("{name}", selectedOption.name)}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {labels.detailsDescription}
                  </p>
                </div>
              ) : null}
              {mode === "edit" ? (
                <div className="space-y-2">
                  <Label htmlFor="task-name">{labels.name}</Label>
                  <Input
                    id="task-name"
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
                    projectOptions={localProjectOptions}
                    value={projectId}
                    onChange={setProjectId}
                    projectLabel={labels.projectLabel}
                    noneLabel={labels.projectNone}
                    searchPlaceholder={labels.projectSearchPlaceholder}
                    emptyResults={labels.projectEmptyResults}
                    projectCreate={labels.projectCreate}
                    projectCreateNamed={labels.projectCreateNamed}
                    onCreateProject={handleCreateProject}
                  />
                </div>
              ) : null}

              <div
                className={cn(
                  "space-y-2",
                  useModalFieldFill && "flex min-h-0 flex-1 flex-col",
                )}
              >
                <Label htmlFor="task-description">{labels.details}</Label>
                <FileUpload
                  className={cn(useModalFieldFill && "min-h-0 flex-1")}
                  value={pendingUploadFiles}
                  onValueChange={setPendingUploadFiles}
                  onAccept={(files) => {
                    void handleAttachFiles(files);
                  }}
                  multiple
                >
                  <FileUploadDropzone
                    className={cn(
                      "data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent",
                      useModalFieldFill && "min-h-0 flex-1",
                    )}
                    onClick={(event) => event.preventDefault()}
                  >
                    <MarkdownEditor
                      ref={markdownEditorRef}
                      id="task-description"
                      placeholder={labels.descriptionPlaceholder}
                      className={cn(
                        "w-full",
                        useModalFieldFill && "flex min-h-0 flex-1 flex-col",
                      )}
                      editorClassName={
                        useModalFieldFill ? "max-h-none flex-1" : undefined
                      }
                      value={description}
                      onChange={setDescription}
                      onSubmitShortcut={() => {
                        const shortcutStatus =
                          mode === "create" ? TaskStatus.READY : undefined;
                        void handleSave(shortcutStatus);
                      }}
                      onAttachClick={() =>
                        attachmentTriggerRef.current?.click()
                      }
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
          ) : null}

          {showCoworkerGrid ? (
            <div className="space-y-4 border-t px-6 py-6 md:px-8">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  {chooseAgentLabel}
                </Label>
                {labels.chooseAgentDescription ? (
                  <p className="text-muted-foreground text-xs">
                    {labels.chooseAgentDescription}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {coworkerOptions.map((option) => (
                  <CoworkerCard
                    key={option.id}
                    option={option}
                    isSelected={assigneeId === option.id}
                    isDefault={option.slug === "elena"}
                    onSelect={() => handleCoworkerSelect(option.id)}
                    labels={cardLabels}
                  />
                ))}
              </div>
              {selectedOption ? (
                <AgentDetail
                  option={selectedOption}
                  examplesTitle={examplesTitle}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {showTaskStep ? (
          <TaskScheduleModal
            open={isScheduleModalOpen}
            onOpenChange={setIsScheduleModalOpen}
            initialSelection={scheduleSelection}
            onApply={setScheduleSelection}
            onClearSchedule={handleClearSchedule}
          />
        ) : null}

        {showTaskStep && shouldShowProjectSelect ? (
          <InlineCreateProjectModal
            open={isCreateProjectModalOpen}
            onOpenChange={setIsCreateProjectModalOpen}
            initialName={createProjectQuery}
            onCreated={handleProjectCreated}
          />
        ) : null}

        {showTaskStep ? (
          <div
            className={
              isModal
                ? "flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8"
                : "flex flex-col items-stretch justify-between gap-3 border-t px-6 py-6 sm:flex-row sm:items-center md:px-8"
            }
          >
            {hasSchedule && scheduleLabel && ScheduleFooterIcon ? (
              <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                <ScheduleFooterIcon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{scheduleLabel}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-3 sm:ml-auto">
              {mode === "create" ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={createdTask !== null}
                    aria-label={labels.openSchedule}
                    aria-pressed={hasSchedule}
                    onClick={() => setIsScheduleModalOpen(true)}
                  >
                    <CalendarClock className="size-4" aria-hidden />
                  </Button>
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
                      {hasSchedule
                        ? (labels.scheduleTask ??
                          labels.createTask ??
                          labels.submit)
                        : (labels.createTask ?? labels.submit)}
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={createdTask !== null}
                    aria-label={labels.openSchedule}
                    aria-pressed={hasSchedule}
                    onClick={() => setIsScheduleModalOpen(true)}
                  >
                    <CalendarClock className="size-4" aria-hidden />
                  </Button>
                  {shouldShowEditToggle ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-28"
                      onClick={handleStatusToggle}
                      disabled={isStatusToggleDisabled}
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
        ) : null}
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
