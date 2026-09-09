"use client";

import {
  CORE_API_ERROR_KINDS,
  formatTaskAttachmentMarkdown,
  isAgentOnlyTaskStatus,
} from "@sokosumi/utils";
import {
  ArrowLeft,
  CalendarClock,
  Command,
  CornerDownLeft,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  type RefObject,
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
import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { VendorMark } from "@/components/agents/vendor-mark";
import { AssistantOrb } from "@/components/aurora-orb";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { formatTaskScheduleSelectionLabel } from "@/components/schedules/format";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOSDetection } from "@/hooks/use-os-detection";
import {
  type CreateTaskResult,
  createTask,
  type TaskContextSelectionInput,
  updateTask,
} from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { Project } from "@/lib/clients/generated/core/types.gen";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { cn } from "@/lib/utils";
import { uploadComposeAttachments } from "@/lib/utils/compose-upload.client";
import { getScheduleIcon } from "@/lib/utils/schedule-icon";
import {
  extractTaskAttachmentUrls,
  removeTaskAttachmentLinks,
} from "@/lib/utils/task-attachments";
import {
  hasTaskScheduleChanged,
  metadataToSelection,
  selectionToApiBody,
} from "@/lib/utils/task-schedule";
import { taskScheduleSeriesFeedbackKey } from "@/lib/utils/task-schedule-feedback";
import {
  canSelectQueuedTaskStatus,
  getManualTaskStatusSelectOptions,
} from "@/lib/utils/task-status-order";
import { AgentSpotlight } from "./agent-spotlight";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import {
  getDefaultTaskContextSelection,
  TaskContextAttachmentsField,
  type TaskContextAttachmentsSelection,
} from "./task-context-attachments";
import { TaskCreatedCelebration } from "./task-created-celebration";
import { TaskFormModalHeaderStart } from "./task-form-modal";
import { TaskProjectSelect } from "./task-project-select";
import { TaskScheduleModal } from "./task-schedule-modal";
import { TaskStatusPillSelectTrigger } from "./task-status-pill-select-trigger";

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
  coworkerDescription: string;
  unassigned?: string;
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
  statusQueued?: string;
  statusReady: string;
  statusLabels?: Record<TaskStatus, string>;
  back: string;
  uploadFile: string;
  uploadFileError?: string;
  uploadingFile: string;
  uploadingFiles: string;
  removeAttachment?: string;
  submit: string;
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
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  status?: TaskStatus;
  metadata?: string | null;
  nextRunAt?: string | null;
  schedule?: TaskScheduleSelection;
}

export type TaskFormInitialDesignMdAttachment = EffectiveDesignMdAttachment;

/** Sentinel for the edit assignee select's Unassigned item (Radix needs non-empty values). */
const UNASSIGNED_SELECT_VALUE = "__unassigned__";

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

function resolveStatusForAssigneeAndSchedule(options: {
  isAgent: boolean;
  hasSchedule: boolean;
}): TaskStatus {
  if (options.hasSchedule) {
    return options.isAgent ? TaskStatus.QUEUED : TaskStatus.READY;
  }
  return options.isAgent ? TaskStatus.READY : TaskStatus.DRAFT;
}

function resolveCelebrationStatus(options: {
  desiredStatus: TaskStatus;
  isAgent: boolean;
  hasSchedule: boolean;
}): "DRAFT" | "QUEUED" | "READY" {
  if (options.desiredStatus === TaskStatus.DRAFT) {
    return "DRAFT";
  }
  // Honor an explicit Queued create when the action succeeded (Core accepted).
  if (options.desiredStatus === TaskStatus.QUEUED) {
    return "QUEUED";
  }
  if (options.hasSchedule) {
    return options.isAgent ? "QUEUED" : "READY";
  }
  return "READY";
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

/**
 * The operation identity of a series save, keyed to the schedule it submits:
 * retrying the same save replays on Core, while editing the rule again starts
 * a new operation. Minted in the browser and never on the server.
 */
function seriesOperationIdFor(
  selection: TaskScheduleSelection,
  operation: RefObject<{ key: string; operationId: string } | null>,
): string {
  const key =
    selection.mode === "none"
      ? "none"
      : JSON.stringify(selectionToApiBody(selection));
  if (operation.current?.key !== key) {
    operation.current = { key, operationId: crypto.randomUUID() };
  }
  return operation.current.operationId;
}

export interface TaskFormCreateInput {
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  projectId?: string | null;
  context: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  schedule?: TaskScheduleSelection;
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
  /**
   * Schedule revision observed when this edit surface was rendered. It is the
   * precondition for every write while the Task has a live series.
   */
  scheduleRevision?: number;
  /**
   * Durable future exceptions a full-series edit would cancel, read with
   * {@link scheduleRevision}. Above zero the save asks to confirm the discard;
   * `null` means the ledger could not be read, and a full-series edit is
   * refused rather than sent without that warning.
   */
  futureExceptionCount?: number | null;
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
  scheduleRevision,
  futureExceptionCount: observedFutureExceptionCount = 0,
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
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const formatter = useFormatter();
  // The Task already had a schedule when this form opened, so every schedule
  // write below is a change to a live series rather than arming a new one.
  const hadSchedule = Boolean(
    initialValues?.metadata ||
      (initialValues?.nextRunAt && initialValues.nextRunAt.length > 0),
  );
  // A live series owns the Task's status and Calendar source: Core rejects
  // status changes with `schedule_active`, and moving the source is SOK-887.
  const hasActiveSeries = mode === "edit" && hadSchedule;
  const hasProjectSelection = projectOptions !== undefined && !hasActiveSeries;
  const shouldShowProjectSelect = hasProjectSelection && !lockProjectSelection;
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  const [name, setName] = useState(initialValues?.name ?? "");
  const initialDescription = initialValues?.description ?? "";
  const [description, setDescription] = useState(initialDescription);
  // `undefined` means the caller made no choice yet (Calendar slot creation on
  // an unfiltered Workspace Calendar); `null` is an explicit "no project".
  const initialProjectId =
    initialValues && "projectId" in initialValues
      ? initialValues.projectId
      : defaultProjectId;
  const [projectId, setProjectId] = useState<string | null | undefined>(
    initialProjectId,
  );
  const [isProjectMissing, setIsProjectMissing] = useState(false);
  const projectSelectRef = useRef<HTMLButtonElement>(null);
  const projectErrorId = useId();
  useLayoutEffect(() => {
    if (isProjectMissing) {
      projectSelectRef.current?.focus();
    }
  }, [isProjectMissing]);
  const [contextSelection, setContextSelection] =
    useState<TaskContextAttachmentsSelection>(() =>
      getDefaultTaskContextSelection(
        initialProjectId
          ? projectOptions?.find((project) => project.id === initialProjectId)
          : undefined,
      ),
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
    // Empty string counts as absent: edit pages pass "" for unset tasks.
    const hasInitialAssignee =
      initialValues?.assigneeId ||
      initialValues?.assigneeSokoBotId ||
      initialValues?.assigneeUserId ||
      null;
    // In edit mode an explicitly unassigned task must stay unassigned:
    // falling through to the create default would silently assign it on save.
    if (mode === "edit" && hasInitialAssignee === null) {
      return "";
    }
    // Default to Elena on first open. Match by slug or name (case-insensitive)
    // so it works across environments (dev seed + mainnet) where the slug may
    // differ; fall back to the highest-priority coworker.
    const elenaCoworker = coworkerOptions.find(
      (option) =>
        option.slug.trim().toLowerCase() === "elena" ||
        option.name.trim().toLowerCase() === "elena",
    );

    return (
      hasInitialAssignee ?? elenaCoworker?.id ?? coworkerOptions[0]?.id ?? ""
    );
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
  const [scheduleSelection, setScheduleSelection] =
    useState<TaskScheduleSelection>(
      () =>
        initialValues?.schedule ??
        metadataToSelection(initialValues?.metadata, getDefaultTimezone()),
    );
  const [status, setStatus] = useState<TaskStatus>(() => {
    if (mode === "edit" && initialValues?.status !== undefined) {
      return initialValues.status;
    }
    const initialSchedule =
      initialValues?.schedule ??
      metadataToSelection(initialValues?.metadata, getDefaultTimezone());
    const fields = resolveTaskAssigneeFields(
      defaultAssigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
    );
    return resolveStatusForAssigneeAndSchedule({
      isAgent: isAgentAssigneeFields(fields),
      hasSchedule: initialSchedule.mode !== "none",
    });
  });

  useLayoutEffect(() => {
    if (coworkerTouchedRef.current) return;
    setAssigneeId(defaultAssigneeId);
    if (!statusTouchedRef.current) {
      const fields = resolveTaskAssigneeFields(
        defaultAssigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      setStatus(
        resolveStatusForAssigneeAndSchedule({
          isAgent: isAgentAssigneeFields(fields),
          hasSchedule: scheduleSelection.mode !== "none",
        }),
      );
    }
  }, [
    defaultAssigneeId,
    coworkerOptions,
    knownSokoBotId,
    initialValues?.assigneeUserId,
    scheduleSelection.mode,
  ]);

  const originalScheduleSelection = useRef(scheduleSelection);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  // A revision conflict proves the observed count describes a series that has
  // since moved on, so from then on this mount treats it as unknown.
  const [isSeriesCountStale, setIsSeriesCountStale] = useState(false);
  const futureExceptionCount = isSeriesCountStale
    ? null
    : observedFutureExceptionCount;
  const [pendingSeriesConfirmation, setPendingSeriesConfirmation] = useState<
    "discard" | "remove" | null
  >(null);
  // One UUID per distinct submitted schedule, so a retry of the same save
  // replays on Core while a re-edited rule becomes a new operation.
  const seriesOperation = useRef<{ key: string; operationId: string } | null>(
    null,
  );
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

      let nextSchedule = scheduleSelection;
      if (isUnassigned && scheduleSelection.mode !== "none") {
        nextSchedule = {
          mode: "none",
          timezone: scheduleSelection.timezone,
        };
        setScheduleSelection(nextSchedule);
      }

      const nextHasSchedule = nextSchedule.mode !== "none";
      const shouldResolveStatus =
        !statusTouchedRef.current ||
        assigneeKindChanged ||
        (status === TaskStatus.QUEUED &&
          !canSelectQueuedTaskStatus({
            isAgent,
            hasSchedule: nextHasSchedule,
          }));
      if (shouldResolveStatus) {
        setStatus(
          resolveStatusForAssigneeAndSchedule({
            isAgent,
            hasSchedule: nextHasSchedule,
          }),
        );
      }
    },
    [
      assigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
      scheduleSelection,
      status,
    ],
  );

  const handleStatusSelect = useCallback((value: TaskStatus) => {
    statusTouchedRef.current = true;
    setStatus(value);
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
    showTaskStep && !isSaveDisabled && !isCreateProjectModalOpen;
  const taskStepTitle = labels.taskStepTitle ?? "What should {name} do?";
  const statusOptions =
    mode === "create"
      ? CREATE_STATUS_OPTIONS
      : getManualTaskStatusSelectOptions(status);

  /**
   * What a save would do to a live series. Replacing the rule always retires
   * its future exceptions, and setting no schedule removes the series outright
   * — both are destructive enough to confirm before they leave the browser.
   * With an unreadable count the replacement cannot say what it would destroy,
   * so it is refused; removal states its own consequence and still proceeds.
   */
  const pendingSeriesChange = useMemo(() => {
    if (
      !hasActiveSeries ||
      !hasTaskScheduleChanged(
        originalScheduleSelection.current,
        scheduleSelection,
        true,
      )
    ) {
      return null;
    }

    if (scheduleSelection.mode === "none") return "remove" as const;
    if (futureExceptionCount === null) return "unknown" as const;
    return futureExceptionCount > 0 ? ("discard" as const) : null;
  }, [futureExceptionCount, hasActiveSeries, scheduleSelection]);

  const handleSave = useCallback(
    async (confirmedSeriesChange = false) => {
      if (isSaveDisabled || (useWizard && step === 1)) return;
      if (pendingSeriesChange === "unknown") {
        setSeriesError(tSeries("unknownCount"));
        return;
      }
      if (pendingSeriesChange && !confirmedSeriesChange) {
        setSeriesError(null);
        setPendingSeriesConfirmation(pendingSeriesChange);
        return;
      }
      if (
        shouldShowProjectSelect &&
        projectId === undefined &&
        labels.projectRequired
      ) {
        setIsProjectMissing(true);
        return;
      }
      setIsSubmitting(true);
      try {
        const trimmedDescription = description.trim();
        const desiredStatus = status;
        if (
          mode === "create" &&
          (desiredStatus === TaskStatus.DRAFT ||
            desiredStatus === TaskStatus.READY ||
            desiredStatus === TaskStatus.QUEUED)
        ) {
          const createTaskHandler = onCreateTask ?? createTask;
          const result = await createTaskHandler({
            description: trimmedDescription,
            ...resolveTaskAssigneeFields(
              assigneeId,
              coworkerOptions,
              knownSokoBotId,
              initialValues?.assigneeUserId,
            ),
            context: {
              brand: {
                enabled: contextSelection.brand.enabled,
                source: contextSelection.brand.source,
                custom: contextSelection.brand.custom
                  ? { url: contextSelection.brand.custom.url }
                  : null,
              },
              briefingEnabled: contextSelection.briefingEnabled,
              contextMdEnabled: contextSelection.contextMdEnabled,
            },
            ...(hasProjectSelection ? { projectId } : {}),
            status: desiredStatus as Extract<
              TaskStatus,
              "DRAFT" | "READY" | "QUEUED"
            >,
            schedule: scheduleSelection,
          });
          if (!result.ok) {
            // A create can now be refused with the same stable kinds an edit
            // can, and only a stale client belongs in the reload modal.
            const feedbackKey = taskScheduleSeriesFeedbackKey(
              result.error.kind,
            );
            if (!feedbackKey) {
              showCalendarClientUpgradeModal();
              return;
            }
            setSeriesError(tSeries(feedbackKey));
            return;
          }
          const createdTask = result.value;
          // Confirm success in place and let the user choose when to navigate;
          // the redirect target is prefetched so it lands fast.
          const assigneeFields = resolveTaskAssigneeFields(
            assigneeId,
            coworkerOptions,
            knownSokoBotId,
            initialValues?.assigneeUserId,
          );
          const createdStatus = resolveCelebrationStatus({
            desiredStatus,
            isAgent: isAgentAssigneeFields(assigneeFields),
            hasSchedule: scheduleSelection.mode !== "none",
          });
          router.prefetch(`/tasks/${createdTask.taskId}`);
          setCreatedTask({
            id: createdTask.taskId,
            name: createdTask.name.trim() || "Untitled task",
            status: createdStatus,
            statusLabel:
              createdStatus === "QUEUED"
                ? (labels.statusQueued ?? "Queued")
                : createdStatus === "DRAFT"
                  ? labels.statusDraft
                  : labels.statusReady,
            scheduleLabel:
              scheduleSelection.mode !== "none" &&
              desiredStatus !== TaskStatus.DRAFT
                ? (scheduleLabel ?? undefined)
                : undefined,
          });
          onCreated?.(createdTask.taskId);
          return;
        }

        if (!taskId) {
          throw new Error("Task ID is required");
        }

        const trimmedName = name.trim();
        const result = await updateTask({
          taskId,
          name: trimmedName,
          description: trimmedDescription,
          ...resolveTaskAssigneeFields(
            assigneeId,
            coworkerOptions,
            knownSokoBotId,
            initialValues?.assigneeUserId,
          ),
          ...(hasProjectSelection ? { projectId } : {}),
          currentStatus: originalStatus,
          desiredStatus,
          schedule: scheduleSelection,
          hadSchedule,
          ...(hasActiveSeries
            ? {
                expectedScheduleRevision: scheduleRevision,
                scheduleOperationId: seriesOperationIdFor(
                  scheduleSelection,
                  seriesOperation,
                ),
              }
            : {}),
          originalSchedule: originalScheduleSelection.current,
        });
        if (!result.ok) {
          if (
            result.error.kind ===
            CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT
          ) {
            // The series moved on, so the count read with the old revision no
            // longer describes it. Nothing here may reuse it as "zero".
            setIsSeriesCountStale(true);
          }
          const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
          if (!feedbackKey) {
            showCalendarClientUpgradeModal();
            return;
          }
          // Keep the form and its operation identity so the user can reload,
          // reopen, and retry the same edit rather than starting a new one.
          setSeriesError(tSeries(feedbackKey));
          return;
        }
        setSeriesError(null);
        if (onSuccess) {
          onSuccess(taskId);
          return;
        }
        router.push(`/tasks/${taskId}`);
      } catch (error) {
        console.error("Failed to save task", error);
        toast.error(
          error instanceof Error && error.message === "Invalid schedule"
            ? tSchedule("errors.futureDateTime")
            : "Failed to save task",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [
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
      showCalendarClientUpgradeModal,
      scheduleSelection,
      scheduleLabel,
      hadSchedule,
      hasActiveSeries,
      scheduleRevision,
      pendingSeriesChange,
      contextSelection,
      labels.projectRequired,
      labels.statusDraft,
      labels.statusQueued,
      labels.statusReady,
      tSchedule,
      tSeries,
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
    hasSchedule,
  });
  const isSchedulableAssignee =
    isAgentAssignee || selectedAssigneeFields.assigneeUserId !== null;
  // Queued work must stay agent-assigned: Core rejects reassignment away
  // from an agent while QUEUED, so the edit picker locks non-agent options.
  const isAssigneeLockedToAgent = originalStatus === TaskStatus.QUEUED;
  const memberAssigneeOptions = coworkerOptions.filter(
    (option) => option.kind === "user",
  );
  const agentAssigneeOptions = coworkerOptions.filter(
    (option) => option.kind !== "user",
  );
  const showModalCoworkerHeader =
    selectedOption !== undefined && (useComposeLayout || mode === "edit");
  const taskFieldsBorder = showModalCoworkerHeader ? "border-t" : "";
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

  function handleClearSchedule() {
    setScheduleSelection({
      mode: "none",
      timezone: scheduleSelection.timezone,
    });
    if (status === TaskStatus.QUEUED) {
      const fields = resolveTaskAssigneeFields(
        assigneeId,
        coworkerOptions,
        knownSokoBotId,
        initialValues?.assigneeUserId,
      );
      setStatus(
        resolveStatusForAssigneeAndSchedule({
          isAgent: isAgentAssigneeFields(fields),
          hasSchedule: false,
        }),
      );
    }
  }

  function handleScheduleApply(selection: TaskScheduleSelection) {
    setScheduleSelection(selection);
    const fields = resolveTaskAssigneeFields(
      assigneeId,
      coworkerOptions,
      knownSokoBotId,
      initialValues?.assigneeUserId,
    );
    const isAgent = isAgentAssigneeFields(fields);
    const nextHasSchedule = selection.mode !== "none";
    const shouldResolveStatus =
      !statusTouchedRef.current ||
      (status === TaskStatus.QUEUED &&
        !canSelectQueuedTaskStatus({
          isAgent,
          hasSchedule: nextHasSchedule,
        }));
    if (shouldResolveStatus) {
      setStatus(
        resolveStatusForAssigneeAndSchedule({
          isAgent,
          hasSchedule: nextHasSchedule,
        }),
      );
    }
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
        <div className="[&::-webkit-scrollbar-thumb]:bg-border/80 flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
          {useWizard && step === 1 ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8">
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

          {showModalCoworkerHeader ? (
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

              {mode === "edit" ? (
                <div className="space-y-2">
                  <Label htmlFor="task-assignee">{labels.coworker}</Label>
                  <Select
                    value={assigneeId || UNASSIGNED_SELECT_VALUE}
                    onValueChange={(value) =>
                      handleCoworkerSelect(
                        value === UNASSIGNED_SELECT_VALUE ? "" : value,
                      )
                    }
                  >
                    <SelectTrigger id="task-assignee" className="w-full">
                      <SelectValue
                        placeholder={labels.unassigned ?? "Unassigned"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value={UNASSIGNED_SELECT_VALUE}
                        disabled={isAssigneeLockedToAgent}
                      >
                        {labels.unassigned ?? "Unassigned"}
                      </SelectItem>
                      {memberAssigneeOptions.length > 0 ? (
                        <SelectGroup>
                          <SelectLabel>
                            {memberAssigneeOptions[0]?.vendor.name}
                          </SelectLabel>
                          {memberAssigneeOptions.map((option) => (
                            <SelectItem
                              key={option.id}
                              value={option.id}
                              disabled={isAssigneeLockedToAgent}
                            >
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      <SelectGroup>
                        <SelectLabel>{labels.coworker}</SelectLabel>
                        {agentAssigneeOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {labels.coworkerDescription ? (
                    <p className="text-muted-foreground text-xs">
                      {labels.coworkerDescription}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {shouldShowProjectSelect ? (
                <div className="space-y-2">
                  <Label>{labels.projectLabel}</Label>
                  <TaskProjectSelect
                    ref={projectSelectRef}
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
                  {isProjectMissing && labels.projectRequired ? (
                    <p id={projectErrorId} className="text-destructive text-xs">
                      {labels.projectRequired}
                    </p>
                  ) : null}
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
                        void handleSave();
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
                {mode === "create" ? (
                  <TaskContextAttachmentsField
                    defaultBrand={initialDesignMdAttachment ?? null}
                    project={selectedProject}
                    selection={contextSelection}
                    onSelectionChange={setContextSelection}
                  />
                ) : null}
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
        </div>

        {showTaskStep ? (
          <TaskScheduleModal
            open={isScheduleModalOpen}
            onOpenChange={setIsScheduleModalOpen}
            initialSelection={scheduleSelection}
            onApply={handleScheduleApply}
            onClearSchedule={handleClearSchedule}
          />
        ) : null}

        {pendingSeriesConfirmation ? (
          <AlertDialog
            open
            onOpenChange={(open) => !open && setPendingSeriesConfirmation(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingSeriesConfirmation === "remove"
                    ? tSeries("removeTitle")
                    : tSeries("discardTitle", {
                        count: futureExceptionCount ?? 0,
                      })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingSeriesConfirmation === "remove"
                    ? tSeries("removeDescription")
                    : tSeries("discardDescription", {
                        count: futureExceptionCount ?? 0,
                      })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {pendingSeriesConfirmation === "remove"
                    ? tSeries("removeCancel")
                    : tSeries("discardCancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setPendingSeriesConfirmation(null);
                    void handleSave(true);
                  }}
                >
                  {pendingSeriesConfirmation === "remove"
                    ? tSeries("removeConfirm")
                    : tSeries("discardConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            <div className="flex min-w-0 items-center gap-2">
              <Select
                value={status}
                onValueChange={(value) =>
                  handleStatusSelect(value as TaskStatus)
                }
              >
                <TaskStatusPillSelectTrigger
                  status={status}
                  label={getTaskFormStatusLabel(status, labels)}
                  ariaLabel={labels.status}
                />
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      disabled={
                        (isAgentOnlyTaskStatus(option) && !isAgentAssignee) ||
                        (option === TaskStatus.QUEUED && !isQueuedSelectable)
                      }
                    >
                      {getTaskFormStatusLabel(option, labels)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {seriesError ||
              (hasSchedule && scheduleLabel && ScheduleFooterIcon) ? (
                <div className="flex min-w-0 flex-col gap-1">
                  {seriesError ? (
                    <p
                      role="alert"
                      className="text-destructive flex min-w-0 items-start gap-2 text-sm"
                    >
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden
                      />
                      <span>{seriesError}</span>
                    </p>
                  ) : null}
                  {hasSchedule && scheduleLabel && ScheduleFooterIcon ? (
                    <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                      <ScheduleFooterIcon
                        className="size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{scheduleLabel}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3 sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={createdTask !== null || !isSchedulableAssignee}
                aria-label={labels.openSchedule}
                aria-pressed={hasSchedule}
                onClick={() => setIsScheduleModalOpen(true)}
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
                    ? hasSchedule
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
