"use client";

import {
  formatTaskAttachmentMarkdown,
  isAgentOnlyTaskStatus,
  taskContextSelectionResolvesAnything,
} from "@sokosumi/utils";
import {
  ArrowLeft,
  CalendarClock,
  Command,
  CornerDownLeft,
  Loader2,
  Lock,
  Paperclip,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import {
  isOtherHumanAssignee,
  resolveTaskAssigneeFields,
} from "@/app/tasks/utils/coworker-options";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { VendorMark } from "@/components/agents/vendor-mark";
import { AssistantOrb } from "@/components/aurora-orb";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useOSDetection } from "@/hooks/use-os-detection";
import {
  type CreateTaskResult,
  createTask,
  type TaskContextSelectionInput,
  updateTask,
} from "@/lib/actions/task/action";
import { useSession } from "@/lib/auth/auth.client";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { Project } from "@/lib/clients/generated/core/types.gen";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import {
  extractTaskAttachmentUrls,
  removeTaskAttachmentLinks,
} from "@/lib/utils/task-attachments";
import {
  canSelectQueuedTaskStatus,
  TASK_STATUS_DISPLAY_ORDER,
} from "@/lib/utils/task-status-order";
import { AgentSpotlight } from "./agent-spotlight";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { TaskAssigneePicker } from "./task-assignee-picker";
import {
  getDefaultTaskContextSelection,
  getTaskContextSelectionFromDescription,
  TaskContextAttachmentsField,
  type TaskContextAttachmentsSelection,
} from "./task-context-attachments";
import { TaskCreatedCelebration } from "./task-created-celebration";
import { TaskFormModalHeaderStart } from "./task-form-modal";
import { TaskProjectSelect } from "./task-project-select";
import { TaskRunAtModal } from "./task-run-at-modal";
import { TaskStatusPicker } from "./task-status-picker";

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
  projectPlaceholder?: string;
  projectRequired?: string;
  coworker: string;
  unassigned: string;
  unavailableAssignee: string;
  changeCoworker: string;
  noCoworkerMatches: string;
  defaultBadge?: string;
  modelLabel?: string;
  hostingLabel?: string;
  taskStepTitle?: string;
  noResults?: string;
  tasksTitle?: string;
  startFromScratch?: string;
  startFromScratchHint?: string;
  previewExample?: string;
  previewUse?: string;
  previewEmpty?: string;
  status: string;
  statusDescription: string;
  statusDraft: string;
  statusQueued: string;
  statusReady: string;
  statusLabels?: Record<TaskStatus, string>;
  changeStatus: string;
  noStatusMatches: string;
  back: string;
  uploadFile: string;
  uploadFileError?: string;
  uploadingFile: string;
  uploadingFiles: string;
  removeAttachment: string;
  submit: string;
  createTask?: string;
  scheduleTask?: string;
  openRunAt: string;
  cancel: string;
  ctrl: string;
  taskCreated?: string;
  taskCreatedHint?: string;
  goToTask?: string;
  createAnother?: string;
  untitledTask: string;
  saveError: string;
  privateLabel?: string;
  privateDescription?: string;
}

interface TaskFormInitialValues {
  name?: string;
  description?: string;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
  /** Statuses Core lets this viewer move the Task to; edit mode only (ADR 0029). */
  selectableStatuses?: readonly TaskStatus[];
  /** The Task's Run at as an ISO string; set only while it is Queued. */
  runAt?: string | null;
}

export type TaskFormInitialDesignMdAttachment = EffectiveDesignMdAttachment;

const CREATE_STATUS_OPTIONS = [
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
] as const;

function isAgentAssigneeFields(fields: {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
}): boolean {
  return fields.assigneeId !== null || fields.assigneeSokoBotId !== null;
}

/** A Run at queues the Task (agents only); otherwise agents start Ready. */
function resolveStatusForAssigneeAndRunAt(options: {
  isAgent: boolean;
  hasRunAt: boolean;
}): TaskStatus {
  if (options.isAgent) {
    return options.hasRunAt ? TaskStatus.QUEUED : TaskStatus.READY;
  }
  return TaskStatus.DRAFT;
}

function getTaskFormStatusLabel(
  value: TaskStatus,
  labels: TaskFormLabels,
): string {
  return (
    labels.statusLabels?.[value] ??
    (value === TaskStatus.DRAFT
      ? labels.statusDraft
      : value === TaskStatus.READY
        ? labels.statusReady
        : value === TaskStatus.QUEUED
          ? (labels.statusQueued ?? value)
          : value)
  );
}

export interface TaskFormCreateInput {
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  projectId?: string | null;
  context: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  /** ISO time the Task starts at; set only with status Queued. */
  runAt?: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

export type TaskFormCreateHandler = (
  input: TaskFormCreateInput,
) => Promise<CreateTaskResult>;

interface TaskFormProps {
  mode: "create" | "edit";
  labels: TaskFormLabels;
  coworkerOptions: CoworkerOption[];
  agentNameById?: Map<string, string>;
  taskId?: string;
  initialValues?: TaskFormInitialValues;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  projectOptions?: ProjectFilterOption[];
  lockProjectSelection?: boolean;
  defaultProjectId?: string | null;
  onCancel?: () => void;
  onSuccess?: (taskId: string) => void;
  /** Runs right after a modal create succeeds (before the celebration step). */
  onCreated?: (taskId: string) => void;
  onCreateAnother?: () => void;
  onCreateTask?: TaskFormCreateHandler;
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
  lockProjectSelection = false,
  defaultProjectId = null,
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
  const { data: session } = useSession();
  const canCreatePrivateTask = Boolean(session?.session.activeOrganizationId);
  const tRunAt = useTranslations("App.Tasks.RunAt");
  const formatter = useFormatter();
  const hasProjectSelection = projectOptions !== undefined;
  const shouldShowProjectSelect = hasProjectSelection && !lockProjectSelection;
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  const [name, setName] = useState(initialValues?.name ?? "");
  const [isPrivate, setIsPrivate] = useState(false);
  // `undefined` means the caller made no choice yet (Calendar slot creation on
  // an unfiltered Workspace Calendar); `null` is an explicit "no project".
  const initialProjectId =
    initialValues && "projectId" in initialValues
      ? initialValues.projectId
      : defaultProjectId;
  const initialProject = initialProjectId
    ? projectOptions?.find((project) => project.id === initialProjectId)
    : undefined;
  const initialContext =
    mode === "edit"
      ? getTaskContextSelectionFromDescription(
          initialValues?.description ?? "",
          {
            project: initialProject,
            defaultBrandUrl: initialDesignMdAttachment?.url ?? null,
            userId: session?.user.id ?? null,
          },
        )
      : null;
  const [projectId, setProjectId] = useState<string | null | undefined>(
    initialProjectId,
  );
  const [isProjectMissing, setIsProjectMissing] = useState(false);
  const projectSelectRef = useRef<HTMLButtonElement>(null);
  const projectErrorId = useId();
  const privateDescriptionId = useId();
  useLayoutEffect(() => {
    if (isProjectMissing) {
      projectSelectRef.current?.focus();
    }
  }, [isProjectMissing]);
  const [contextSelection, setContextSelection] =
    useState<TaskContextAttachmentsSelection>(
      () =>
        initialContext?.selection ??
        getDefaultTaskContextSelection(initialProject),
    );
  const initialDescription =
    initialContext?.body ?? initialValues?.description ?? "";
  const [description, setDescription] = useState(initialDescription);
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
    const fromTask =
      initialValues?.assigneeId ||
      initialValues?.assigneeSokoBotId ||
      initialValues?.assigneeUserId ||
      "";
    if (mode === "edit") {
      return fromTask;
    }
    if (fromTask) {
      return fromTask;
    }
    const elenaCoworker = coworkerOptions.find(
      (option) =>
        option.slug.trim().toLowerCase() === "elena" ||
        option.name.trim().toLowerCase() === "elena",
    );
    return elenaCoworker?.id ?? coworkerOptions[0]?.id ?? "";
  }, [
    mode,
    coworkerOptions,
    initialValues?.assigneeId,
    initialValues?.assigneeSokoBotId,
    initialValues?.assigneeUserId,
  ]);

  const knownSokoBotId = useMemo(
    () =>
      coworkerOptions.find((option) => option.kind === "sokoBot")?.id ??
      initialValues?.assigneeSokoBotId ??
      null,
    [coworkerOptions, initialValues?.assigneeSokoBotId],
  );

  const coworkerTouchedRef = useRef(false);
  const statusTouchedRef = useRef(
    mode === "edit" && initialValues?.status !== undefined,
  );
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const initialRunAt = initialValues?.runAt ?? null;
  // Only an agent can hold a Run at (Queued is agent-only), so a Calendar
  // prefill for a person is dropped rather than sent and refused by Core.
  const [runAt, setRunAt] = useState<string | null>(() =>
    isAgentAssigneeFields(
      resolveTaskAssigneeFields(
        defaultAssigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      ),
    )
      ? initialRunAt
      : null,
  );
  const [status, setStatus] = useState<TaskStatus>(() => {
    if (mode === "edit" && initialValues?.status !== undefined) {
      return initialValues.status;
    }
    const fields = resolveTaskAssigneeFields(
      defaultAssigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
    );
    return resolveStatusForAssigneeAndRunAt({
      isAgent: isAgentAssigneeFields(fields),
      hasRunAt: initialRunAt !== null,
    });
  });

  useLayoutEffect(() => {
    if (coworkerTouchedRef.current) return;
    setAssigneeId(defaultAssigneeId);
    const isAgent = isAgentAssigneeFields(
      resolveTaskAssigneeFields(
        defaultAssigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      ),
    );
    if (!isAgent) setRunAt(null);
    if (!statusTouchedRef.current) {
      setStatus(
        resolveStatusForAssigneeAndRunAt({
          isAgent,
          hasRunAt: isAgent && runAt !== null,
        }),
      );
    }
  }, [
    defaultAssigneeId,
    coworkerOptions,
    knownSokoBotId,
    initialValues?.assigneeUserId,
    runAt,
  ]);

  const [isRunAtModalOpen, setIsRunAtModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(description),
    [description],
  );
  const mentionOptions = useMemo(
    () => convertAgentNamesToMentionOptions(agentNameById),
    [agentNameById],
  );
  const isSubmittingAny = isSubmitting;
  useEffect(() => {
    onCreatedChange?.(createdTask !== null);
  }, [createdTask, onCreatedChange]);

  const handleCoworkerSelect = useCallback(
    (id: string) => {
      coworkerTouchedRef.current = true;
      const previousFields = resolveTaskAssigneeFields(
        assigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      const previousIsAgent = isAgentAssigneeFields(previousFields);
      setAssigneeId(id);
      const fields = resolveTaskAssigneeFields(
        id,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      const isAgent = isAgentAssigneeFields(fields);
      const isUnassigned =
        fields.assigneeId === null &&
        fields.assigneeSokoBotId === null &&
        fields.assigneeUserId === null;
      const assigneeKindChanged = previousIsAgent !== isAgent || isUnassigned;

      // Queued is agent-only, so a person or no one cannot keep a Run at.
      const nextRunAt = isAgent ? runAt : null;
      if (nextRunAt !== runAt) {
        setRunAt(null);
      }

      const shouldResolveStatus =
        !statusTouchedRef.current ||
        assigneeKindChanged ||
        (status === TaskStatus.QUEUED &&
          !canSelectQueuedTaskStatus({
            isAgent,
            hasRunAt: nextRunAt !== null,
          }));
      if (shouldResolveStatus) {
        setStatus(
          resolveStatusForAssigneeAndRunAt({
            isAgent,
            hasRunAt: nextRunAt !== null,
          }),
        );
      }
    },
    [
      assigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
      runAt,
      status,
    ],
  );

  const handleStatusSelect = useCallback((value: TaskStatus) => {
    statusTouchedRef.current = true;
    setStatus(value);
    // A Run at only exists on a Queued Task; leaving Queued drops it.
    if (value !== TaskStatus.QUEUED) {
      setRunAt(null);
    }
  }, []);

  const handleCreateProject = useCallback((searchQuery: string) => {
    setCreateProjectQuery(searchQuery);
    setIsCreateProjectModalOpen(true);
  }, []);

  const handleProjectChange = useCallback(
    (nextProjectId: string | null, nextProject?: ProjectFilterOption) => {
      setProjectId(nextProjectId);
      setIsProjectMissing(false);
      const project =
        nextProject ??
        (nextProjectId
          ? localProjectOptions.find((item) => item.id === nextProjectId)
          : undefined);
      setContextSelection((current) => ({
        ...current,
        brand: {
          ...current.brand,
          source: project?.designMd
            ? "project"
            : current.brand.source === "project"
              ? "default"
              : current.brand.source,
        },
      }));
    },
    [localProjectOptions],
  );

  const handleProjectCreated = useCallback(
    (result: { projectId: string; name: string; project?: Project }) => {
      // Carry the fresh project's context files so the Context row can offer
      // Briefing / Memory / Brand right away instead of after a reload.
      const newProject: ProjectFilterOption = {
        id: result.projectId,
        name: result.name,
        logo: result.project?.logo ?? null,
        designMd: result.project?.designMd ?? null,
        briefingUrl: result.project?.briefingUrl ?? null,
        contextMd: result.project?.contextMd ?? null,
      };
      setInlineCreatedProjects((prev) => [...prev, newProject]);
      handleProjectChange(result.projectId, newProject);
    },
    [handleProjectChange],
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
  const selectedProject = useMemo(
    () =>
      projectId
        ? localProjectOptions.find((project) => project.id === projectId)
        : undefined,
    [localProjectOptions, projectId],
  );
  const isUploadingAttachments = uploadingAttachmentsCount > 0;
  const hasRunAt = runAt !== null;
  const runAtLabel = runAt
    ? tRunAt("footer", {
        datetime: formatter.dateTime(new Date(runAt), "dateTime"),
      })
    : null;
  useEffect(() => {
    onSubmittingChange?.(isSubmittingAny || isUploadingAttachments);
  }, [isSubmittingAny, isUploadingAttachments, onSubmittingChange]);
  const hasSaveableDescription =
    Boolean(description.trim()) ||
    (mode === "edit" &&
      taskContextSelectionResolvesAnything(contextSelection, {
        projectDesignMdUrl: selectedProject?.designMd?.url ?? null,
        workspaceDesignMdUrl: initialDesignMdAttachment?.url ?? null,
        projectBriefingUrl: selectedProject?.briefingUrl ?? null,
        projectContextMdUrl: selectedProject?.contextMd?.url ?? null,
      }));
  const isSaveDisabled =
    createdTask !== null ||
    !hasSaveableDescription ||
    (isNameRequired && !name.trim()) ||
    isSubmittingAny ||
    isUploadingAttachments;

  // Two-step create flow: 1 = spotlight (pick a coworker + a ready-to-run task,
  // or start from scratch), 2 = compose. Skip the wizard only when a coworker
  // is prefilled (gallery offer, agents-page deep link). A prompt alone does not
  // skip step 1 — otherwise a bad coworker slug would land on compose with the
  // default assignee.
  const hasPrefilledAssignee = Boolean(
    initialValues?.assigneeId ??
      initialValues?.assigneeSokoBotId ??
      initialValues?.assigneeUserId,
  );
  const useWizard = mode === "create" && !hasPrefilledAssignee;
  const [step, setStep] = useState<1 | 2>(hasPrefilledAssignee ? 2 : 1);
  const showTaskStep = !useWizard || step === 2;
  const useComposeLayout = mode === "create" && showTaskStep;
  const useModalFieldFill = showTaskStep;
  const canUseSubmitShortcut =
    showTaskStep &&
    !isSaveDisabled &&
    !isCreateProjectModalOpen &&
    !isRunAtModalOpen;
  const taskStepTitle = labels.taskStepTitle ?? "What should {name} do?";
  const statusPickerLabels = useMemo(
    () =>
      Object.fromEntries(
        TASK_STATUS_DISPLAY_ORDER.map((option) => [
          option,
          getTaskFormStatusLabel(option, labels),
        ]),
      ) as Record<TaskStatus, string>,
    [labels],
  );

  const handleSave = useCallback(async () => {
    if (isSaveDisabled || (useWizard && step === 1)) return;
    if (
      shouldShowProjectSelect &&
      projectId === undefined &&
      labels.projectRequired
    ) {
      setIsProjectMissing(true);
      return;
    }
    // Edit sends the Run at only when it changed. A time that passed while
    // the form sat open would be refused by Core, so say so before sending.
    const sendsRunAt =
      runAt !== null && (mode === "create" || runAt !== initialRunAt);
    if (sendsRunAt && new Date(runAt) <= new Date()) {
      toast.error(tRunAt("notInFuture"));
      return;
    }
    setIsSubmitting(true);
    try {
      const trimmedDescription = description.trim();
      const trimmedName = name.trim();
      const context: TaskContextSelectionInput = {
        brand: {
          enabled: contextSelection.brand.enabled,
          source: contextSelection.brand.source,
          custom: contextSelection.brand.custom
            ? { url: contextSelection.brand.custom.url }
            : null,
        },
        briefingEnabled: contextSelection.briefingEnabled,
        contextMdEnabled: contextSelection.contextMdEnabled,
      };
      const assigneeFields = resolveTaskAssigneeFields(
        assigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      if (
        mode === "create" &&
        (status === TaskStatus.DRAFT ||
          status === TaskStatus.READY ||
          status === TaskStatus.QUEUED)
      ) {
        const createTaskHandler = onCreateTask ?? createTask;
        const createPrivateUnassigned =
          canCreatePrivateTask &&
          isPrivate &&
          !isOtherHumanAssignee(
            assigneeFields.assigneeUserId,
            session?.user.id,
          );
        const result = await createTaskHandler({
          ...(trimmedName ? { name: trimmedName } : {}),
          description: trimmedDescription,
          ...assigneeFields,
          ...(createPrivateUnassigned
            ? {
                visibility: "PRIVATE" as const,
                assigneeUserId: null,
              }
            : {}),
          context,
          ...(hasProjectSelection ? { projectId } : {}),
          status,
          ...(runAt ? { runAt } : {}),
        });
        if (!result.ok) {
          toast.error(labels.saveError);
          return;
        }
        const createdTask = result.value;
        // Confirm success in place and let the user choose when to navigate;
        // the redirect target is prefetched so it lands fast.
        router.prefetch(`/tasks/${createdTask.taskId}`);
        setCreatedTask({
          id: createdTask.taskId,
          name: createdTask.name.trim() || labels.untitledTask,
          status,
          statusLabel:
            status === TaskStatus.QUEUED
              ? labels.statusQueued
              : status === TaskStatus.DRAFT
                ? labels.statusDraft
                : labels.statusReady,
          scheduleLabel: runAtLabel ?? undefined,
        });
        onCreated?.(createdTask.taskId);
        return;
      }

      if (!taskId) {
        throw new Error("Task ID is required");
      }

      const result = await updateTask({
        taskId,
        name: trimmedName,
        description: trimmedDescription,
        ...assigneeFields,
        ...(hasProjectSelection ? { projectId } : {}),
        context,
        desiredStatus: status,
        // Clearing is never sent: leaving Queued through the status event
        // clears the Run at on Core.
        ...(sendsRunAt ? { runAt } : {}),
      });
      if (!result.ok) {
        toast.error(labels.saveError);
        return;
      }
      if (onSuccess) {
        onSuccess(taskId);
        return;
      }
      router.push(`/tasks/${taskId}`);
    } catch (error) {
      console.error("Failed to save task", error);
      toast.error(labels.saveError);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    description,
    isSaveDisabled,
    mode,
    step,
    useWizard,
    name,
    assigneeId,
    coworkerOptions,
    knownSokoBotId,
    initialValues?.assigneeUserId,
    projectId,
    hasProjectSelection,
    shouldShowProjectSelect,
    originalStatus,
    router,
    status,
    taskId,
    onSuccess,
    onCreated,
    onCreateTask,
    runAt,
    initialRunAt,
    runAtLabel,
    contextSelection,
    canCreatePrivateTask,
    isPrivate,
    session?.user.id,
    labels.projectRequired,
    labels.statusDraft,
    labels.statusQueued,
    labels.statusReady,
    labels.saveError,
    labels.untitledTask,
    tRunAt,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        canUseSubmitShortcut
      ) {
        event.preventDefault();
        void handleSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUseSubmitShortcut, handleSave, mode]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const controller = new AbortController();
      activeUploadControllersRef.current.add(controller);
      setUploadingAttachmentsCount((count) => count + 1);
      try {
        const uploaded = await uploadComposeAttachments(files, {
          abortSignal: controller.signal,
          labels: {
            uploadingFile: labels.uploadingFile,
            uploadingFiles: labels.uploadingFiles,
            uploadError: labels.uploadFileError ?? "Failed to upload file",
          },
        });
        for (const result of uploaded) {
          if (markdownEditorRef.current) {
            markdownEditorRef.current.insertLink(
              result.fileName,
              result.publicUrl,
            );
            markdownEditorRef.current.insertText("\n");
            continue;
          }
          const markdownLink = formatTaskAttachmentMarkdown(
            result.fileName,
            result.publicUrl,
          );
          setDescription(
            (prev) =>
              `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
          );
        }
      } catch {
        // Error toast is handled by uploadComposeAttachments.
      } finally {
        activeUploadControllersRef.current.delete(controller);
        setPendingUploadFiles([]);
        setUploadingAttachmentsCount((count) => count - 1);
      }
    },
    [labels.uploadFileError, labels.uploadingFile, labels.uploadingFiles],
  );

  const handleRemoveAttachment = useCallback((url: string) => {
    setDescription((prev) => removeTaskAttachmentLinks(prev, [url]));
  }, []);

  const selectedOption = useMemo(
    () => coworkerOptions.find((option) => option.id === assigneeId),
    [coworkerOptions, assigneeId],
  );
  const selectedAssigneeFields = useMemo(
    () =>
      resolveTaskAssigneeFields(
        assigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      ),
    [
      assigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
    ],
  );
  const isAgentAssignee =
    selectedAssigneeFields.assigneeId !== null ||
    selectedAssigneeFields.assigneeSokoBotId !== null;
  const isQueuedSelectable = canSelectQueuedTaskStatus({
    isAgent: isAgentAssignee,
    hasRunAt,
  });
  // Edit mode offers what Core marked selectable for the saved Task plus the
  // saved status itself, so an unsaved pick can be undone before saving. A
  // Run at staged in this form makes Queued pickable before Core knows.
  const statusOptions = useMemo<readonly TaskStatus[]>(
    () =>
      mode === "create"
        ? CREATE_STATUS_OPTIONS
        : [
            ...(initialValues?.status ? [initialValues.status] : []),
            ...(initialValues?.selectableStatuses ?? []),
            ...(isQueuedSelectable ? [TaskStatus.QUEUED] : []),
          ],
    [
      mode,
      initialValues?.status,
      initialValues?.selectableStatuses,
      isQueuedSelectable,
    ],
  );
  const showPrivateControl =
    mode === "create" &&
    canCreatePrivateTask &&
    Boolean(labels.privateLabel) &&
    !isOtherHumanAssignee(
      selectedAssigneeFields.assigneeUserId,
      session?.user.id,
    );
  // Queued work must stay agent-assigned: Core rejects reassignment away
  // from an agent while QUEUED, so the edit picker locks non-agent options.
  const isAssigneeLockedToAgent = originalStatus === TaskStatus.QUEUED;
  const showEditAssigneePicker = mode === "edit";
  const showModalCoworkerHeader =
    useComposeLayout && selectedOption !== undefined;
  const taskFieldsBorder =
    showModalCoworkerHeader || showEditAssigneePicker ? "border-t" : "";
  const cardLabels = useMemo(
    () => ({
      defaultBadge: labels.defaultBadge ?? "Default",
      modelLabel: labels.modelLabel ?? "Model",
      hostingLabel: labels.hostingLabel ?? "Hosting",
    }),
    [labels.defaultBadge, labels.modelLabel, labels.hostingLabel],
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

  function handleRunAtApply(nextRunAt: string) {
    setRunAt(nextRunAt);
    setStatus(TaskStatus.QUEUED);
  }

  function handleRunAtClear() {
    setRunAt(null);
    // Removing the time on a saved Task must not start it: like Core's
    // PATCH, it goes back to Draft. A new Task takes the usual default.
    setStatus(
      mode === "edit"
        ? TaskStatus.DRAFT
        : resolveStatusForAssigneeAndRunAt({
            isAgent: isAgentAssignee,
            hasRunAt: false,
          }),
    );
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
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="[&::-webkit-scrollbar-thumb]:bg-tertiary flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
          {useWizard && step === 1 ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8 md:py-0">
              <AgentSpotlight
                options={coworkerOptions}
                selectedId={assigneeId}
                onSelect={handleCoworkerSelect}
                onPickOffer={(offer) => {
                  setDescription(offer.prompt);
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

          {showEditAssigneePicker ? (
            <div className="px-6 py-4 md:px-8">
              <TaskAssigneePicker
                value={assigneeId}
                options={coworkerOptions}
                labels={{
                  ariaLabel: labels.coworker,
                  unassigned: labels.unassigned,
                  unavailableAssignee: labels.unavailableAssignee,
                  searchPlaceholder: labels.changeCoworker,
                  noResults: labels.noCoworkerMatches,
                  agentsGroupLabel: labels.coworker,
                }}
                onSelect={handleCoworkerSelect}
                isOptionDisabled={(option) =>
                  isAssigneeLockedToAgent &&
                  (option === "unassigned" || option.kind === "user")
                }
              />
            </div>
          ) : showModalCoworkerHeader ? (
            <div className="flex items-center gap-3 px-6 py-4 md:px-8">
              {selectedOption.kind === "sokoBot" &&
              !selectedOption.image &&
              selectedOption.avatarSeed ? (
                <AssistantOrb
                  seed={selectedOption.avatarSeed}
                  expression="idle"
                  animate={false}
                  size={36}
                  className="size-9 shrink-0"
                  alt={selectedOption.name}
                />
              ) : (
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
              )}
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
                <h3 className="text-lg font-semibold">
                  {taskStepTitle.replace("{name}", selectedOption.name)}
                </h3>
              ) : null}
              {mode === "edit" ? (
                <input
                  id="task-name"
                  type="text"
                  aria-label={labels.name}
                  placeholder={labels.namePlaceholder}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full border-0 bg-transparent px-0 text-xl leading-tight font-semibold tracking-tight outline-none shadow-none placeholder:text-muted-foreground"
                />
              ) : null}

              <div
                className={cn(
                  useModalFieldFill && "flex min-h-0 flex-1 flex-col",
                )}
              >
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
                      "data-dragging:bg-card-background w-full items-stretch justify-start border-0 p-0 hover:bg-transparent",
                      useModalFieldFill && "min-h-0 flex-1",
                    )}
                    onClick={(event) => event.preventDefault()}
                  >
                    <MarkdownEditor
                      ref={markdownEditorRef}
                      id="task-description"
                      variant="document"
                      ariaLabel={labels.details}
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
                        void handleSave();
                      }}
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
                  <div className="flex flex-wrap gap-2">
                    {attachmentUrls.map((url) => (
                      <FileChipMiniPreviewWithMetadata
                        key={url}
                        url={url}
                        sizeClass="size-16"
                        onRemove={() => handleRemoveAttachment(url)}
                        removeLabel={labels.removeAttachment}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              {shouldShowProjectSelect || showPrivateControl ? (
                <div className="space-y-1">
                  <div
                    data-testid="task-compose-meta-row"
                    className="flex flex-wrap items-center gap-2"
                  >
                    {shouldShowProjectSelect ? (
                      <TaskProjectSelect
                        ref={projectSelectRef}
                        variant="chip"
                        projectOptions={localProjectOptions}
                        value={projectId}
                        onChange={handleProjectChange}
                        projectLabel={labels.projectLabel}
                        noneLabel={labels.projectNone}
                        placeholder={labels.projectPlaceholder}
                        searchPlaceholder={labels.projectSearchPlaceholder}
                        emptyResults={labels.projectEmptyResults}
                        projectCreate={labels.projectCreate}
                        projectCreateNamed={labels.projectCreateNamed}
                        onCreateProject={handleCreateProject}
                        invalid={isProjectMissing}
                        describedBy={
                          isProjectMissing && labels.projectRequired
                            ? projectErrorId
                            : undefined
                        }
                      />
                    ) : null}
                    {showPrivateControl ? (
                      <>
                        {labels.privateDescription ? (
                          <span id={privateDescriptionId} className="sr-only">
                            {labels.privateDescription}
                          </span>
                        ) : null}
                        <HoverCard openDelay={150}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              id="task-private"
                              aria-label={labels.privateLabel}
                              aria-pressed={isPrivate}
                              aria-describedby={
                                labels.privateDescription
                                  ? privateDescriptionId
                                  : undefined
                              }
                              className={cn(
                                "focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
                                isPrivate
                                  ? "bg-secondary text-secondary-foreground border-transparent"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )}
                              onClick={() =>
                                setIsPrivate((current) => !current)
                              }
                            >
                              <Lock className="size-3.5 shrink-0" aria-hidden />
                              {labels.privateLabel}
                            </button>
                          </HoverCardTrigger>
                          {labels.privateDescription ? (
                            <HoverCardContent
                              side="top"
                              align="start"
                              className="w-72 text-sm"
                            >
                              <p className="text-muted-foreground">
                                {labels.privateDescription}
                              </p>
                            </HoverCardContent>
                          ) : null}
                        </HoverCard>
                      </>
                    ) : null}
                  </div>
                  {shouldShowProjectSelect &&
                  isProjectMissing &&
                  labels.projectRequired ? (
                    <p id={projectErrorId} className="text-destructive text-xs">
                      {labels.projectRequired}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <TaskContextAttachmentsField
                layout="inline"
                defaultBrand={initialDesignMdAttachment ?? null}
                project={selectedProject}
                selection={contextSelection}
                onSelectionChange={setContextSelection}
              />
            </div>
          ) : null}
        </div>

        {showTaskStep && isRunAtModalOpen ? (
          <TaskRunAtModal
            runAt={runAt}
            onApply={handleRunAtApply}
            onClear={handleRunAtClear}
            onClose={() => setIsRunAtModalOpen(false)}
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
          <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8">
            <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
              <AttachmentSubmenu
                onUploadClick={() => attachmentTriggerRef.current?.click()}
                onDriveClick={() =>
                  markdownEditorRef.current?.openDrivePicker()
                }
                disabled={
                  createdTask !== null ||
                  isSubmittingAny ||
                  isUploadingAttachments
                }
              >
                <button
                  type="button"
                  aria-label={labels.uploadFile}
                  disabled={
                    createdTask !== null ||
                    isSubmittingAny ||
                    isUploadingAttachments
                  }
                  className="focus-visible:ring-ring text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  {isUploadingAttachments ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Paperclip className="size-3.5" aria-hidden />
                  )}
                </button>
              </AttachmentSubmenu>
              <TaskStatusPicker
                value={status}
                options={statusOptions}
                labels={{
                  statusLabels: statusPickerLabels,
                  ariaLabel: labels.status,
                  searchPlaceholder: labels.changeStatus,
                  noResults: labels.noStatusMatches,
                }}
                onSelect={handleStatusSelect}
                isOptionDisabled={(option) =>
                  (isAgentOnlyTaskStatus(option) && !isAgentAssignee) ||
                  (option === TaskStatus.QUEUED && !isQueuedSelectable)
                }
                align="start"
              />
              {runAtLabel ? (
                <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                  <CalendarClock className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{runAtLabel}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3 sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={createdTask !== null || !isAgentAssignee}
                aria-label={labels.openRunAt}
                aria-pressed={hasRunAt}
                onClick={() => setIsRunAtModalOpen(true)}
              >
                <CalendarClock className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                className="min-w-28 items-center justify-between gap-1"
                disabled={isSaveDisabled}
                onClick={() => handleSave()}
              >
                <div className="flex items-center gap-2">
                  {isSubmitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {mode === "create"
                    ? hasRunAt
                      ? (labels.scheduleTask ??
                        labels.createTask ??
                        labels.submit)
                      : (labels.createTask ?? labels.submit)
                    : labels.submit}
                  {!isMobile ? (
                    <div className="flex items-center gap-1">
                      {os === "MacOS" ? <Command /> : labels.ctrl}
                      <CornerDownLeft />
                    </div>
                  ) : null}
                </div>
              </Button>
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
