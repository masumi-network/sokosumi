"use client";

import type { Project } from "@sokosumi/core-client";
import { TaskStatus } from "@sokosumi/core-client";
import { taskContextSelectionResolvesAnything } from "@sokosumi/utils";
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
import { convertAgentNamesToMentionOptions } from "@/app/tasks/utils/agent-names";
import {
  isOtherHumanAssignee,
  resolveTaskAssigneeFields,
} from "@/app/tasks/utils/coworker-options";
import {
  isAgentAssigneeFields,
  resolveStatusForAssigneeAndRunAt,
} from "@/app/tasks/utils/task-form-status";
import { taskHref } from "@/app/tasks/utils/task-href";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { useOSDetection } from "@/hooks/use-os-detection";
import { useSession } from "@/lib/auth/auth.client";
import {
  canSelectQueuedTaskStatus,
  TASK_STATUS_DISPLAY_ORDER,
} from "@/lib/utils/task-status-order";
import {
  getDefaultTaskContextSelection,
  getTaskContextSelectionFromDescription,
  type TaskContextAttachmentsSelection,
  withProjectBrandSource,
} from "./task-context-attachments";
import type { TaskFormLabels, TaskFormProps } from "./task-form-types";
import { useTaskFormAttachments } from "./use-task-form-attachments";
import { useTaskFormWorkspaceTags } from "./use-task-form-workspace-tags";
import { useTaskTagSuggestions } from "./use-task-tag-suggestions";

const EMPTY_AGENT_NAME_MAP = new Map<string, string>();

const CREATE_STATUS_OPTIONS = [
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
] as const;

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

export function useTaskFormModel({
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
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const formatter = useFormatter();
  const hasProjectSelection = projectOptions !== undefined;
  const shouldShowProjectSelect = hasProjectSelection && !lockProjectSelection;
  const originalStatus = initialValues?.status ?? TaskStatus.DRAFT;
  // A copy is reviewed in full before it exists: its name, its assignee
  // (Unassigned included), and it stays a Draft. It takes the source's tags in
  // Core, so it asks for no tag suggestions.
  const copyOfTaskId =
    mode === "create" ? initialValues?.copyOfTaskId : undefined;
  const isCopy = copyOfTaskId !== undefined;
  const workspaceKey = `${session?.user.id ?? ""}:${session?.session.activeOrganizationId ?? "personal"}`;
  const { workspaceTags, workspaceTagIds, setWorkspaceTags } =
    useTaskFormWorkspaceTags(workspaceKey, initialValues?.workspaceTags);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [name, setName] = useState(initialValues?.name ?? "");
  const [isPrivate, setIsPrivate] = useState(
    initialValues?.visibility === "PRIVATE",
  );
  // `undefined` means the caller made no choice yet (Calendar slot creation on
  // an unfiltered Workspace Calendar); `null` is an explicit "no project".
  const initialProjectId =
    initialValues && "projectId" in initialValues
      ? initialValues.projectId
      : defaultProjectId;
  const initialProject = initialProjectId
    ? projectOptions?.find((project) => project.id === initialProjectId)
    : undefined;
  // A new Task cannot start in a project the viewer cannot pick (closed, or
  // gone since the source Task was made); it starts with no project instead.
  const isInitialProjectUnavailable =
    mode === "create" &&
    Boolean(initialProjectId) &&
    projectOptions !== undefined &&
    !initialProject;
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
    isInitialProjectUnavailable ? null : initialProjectId,
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
    if (mode === "edit" || isCopy) {
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
    isCopy,
    coworkerOptions,
    initialValues?.assigneeId,
    initialValues?.assigneeSokoBotId,
    initialValues?.assigneeUserId,
  ]);

  const knownSokoBotId = useMemo(
    () =>
      // The Task's own Soko Bot first, so it keeps its kind while missing
      // from the options.
      initialValues?.assigneeSokoBotId ??
      coworkerOptions.find((option) => option.kind === "sokoBot")?.id ??
      null,
    [coworkerOptions, initialValues?.assigneeSokoBotId],
  );

  const coworkerTouchedRef = useRef(false);
  const statusTouchedRef = useRef(initialValues?.status !== undefined);
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
    if (initialValues?.status !== undefined) {
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
  // The tag receipt this create sends. Submitting turns the suggestion hook
  // off, which drops its receipt, so progress reads this snapshot instead.
  const [submittedTagReceipt, setSubmittedTagReceipt] = useState<
    string | undefined
  >();
  const [createdTask, setCreatedTask] = useState<{
    id: string;
    identifier: string | null;
    name: string;
    status: "DRAFT" | "QUEUED" | "READY";
    statusLabel: string;
    scheduleLabel?: string;
  } | null>(null);
  const {
    pendingUploadFiles,
    setPendingUploadFiles,
    uploadingAttachmentsCount,
    markdownEditorRef,
    attachmentTriggerRef,
    attachmentUrls,
    abortActiveUploads,
    handleAttachFiles,
    handleRemoveAttachment,
  } = useTaskFormAttachments(description, setDescription, labels);
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
      const keptRunAt = isAgent ? runAt : null;
      if (keptRunAt !== runAt) {
        setRunAt(null);
      }

      const shouldResolveStatus =
        (!isCopy && (!statusTouchedRef.current || assigneeKindChanged)) ||
        (status === TaskStatus.QUEUED &&
          !canSelectQueuedTaskStatus({
            isAgent,
            hasRunAt: keptRunAt !== null,
          }));
      if (shouldResolveStatus) {
        setStatus(
          resolveStatusForAssigneeAndRunAt({
            isAgent,
            hasRunAt: keptRunAt !== null,
          }),
        );
      }
    },
    [
      assigneeId,
      coworkerOptions,
      isCopy,
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
      setContextSelection((current) =>
        withProjectBrandSource(current, project),
      );
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

  const { os, isMobile } = useOSDetection();

  const isNameRequired = mode === "edit" || isCopy;
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
    isCreatingTag ||
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
  const useWizard = mode === "create" && !hasPrefilledAssignee && !isCopy;
  const [step, setStep] = useState<1 | 2>(
    hasPrefilledAssignee || isCopy ? 2 : 1,
  );
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

  const draftTags = useTaskTagSuggestions({
    name,
    description,
    workspaceKey,
    // Not gated on the wizard step: an offer or a deep-linked prompt fills the
    // description on step 1, and classifying it there means tags are already on
    // screen when the user reaches the editor.
    enabled:
      mode === "create" &&
      !isCopy &&
      Boolean(session) &&
      !createdTask &&
      !isSubmitting,
  });

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
  // While a copy is Private, other people cannot be picked: picking one must
  // not publish it. Turning Private off first is the explicit choice.
  const blocksOtherPeople = isCopy && canCreatePrivateTask && isPrivate;
  const showPrivateControl =
    mode === "create" &&
    canCreatePrivateTask &&
    Boolean(labels.privateLabel) &&
    !isOtherHumanAssignee(
      selectedAssigneeFields.assigneeUserId,
      session?.user.id,
    );
  // Core requires an agent while a Task has a Run at. Restore human choices
  // when the Run at is cleared, including while editing a queued Task.
  const availableAssigneeOptions = useMemo(
    () =>
      runAt === null
        ? coworkerOptions
        : coworkerOptions.filter((option) => option.kind !== "user"),
    [coworkerOptions, runAt],
  );
  const isAssigneeLockedToAgent = runAt !== null;
  const showAssigneePicker = mode === "edit" || isCopy;
  const showModalCoworkerHeader =
    useComposeLayout && selectedOption !== undefined;
  const taskFieldsBorder =
    showModalCoworkerHeader || showAssigneePicker ? "border-t" : "";
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

  function handleRunAtApply(value: string) {
    setRunAt(value);
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
      onSuccess({
        id: createdTask.id,
        identifier: createdTask.identifier,
        name: createdTask.name,
      });
      return;
    }
    router.push(
      taskHref({
        id: createdTask.id,
        identifier: createdTask.identifier,
        name: createdTask.name,
      }),
    );
  };

  return {
    mode,
    labels,
    initialValues,
    initialDesignMdAttachment,
    projectOptions,
    onCreated,
    onCreateAnother,
    showCancel,
    session,
    tRunAt,
    shouldShowProjectSelect,
    isCopy,
    setWorkspaceTags,
    workspaceTags,
    setIsCreatingTag,
    name,
    setName,
    isPrivate,
    setIsPrivate,
    projectId,
    isProjectMissing,
    projectSelectRef,
    projectErrorId,
    privateDescriptionId,
    contextSelection,
    setContextSelection,
    initialDescription,
    description,
    setDescription,
    localProjectOptions,
    isCreateProjectModalOpen,
    setIsCreateProjectModalOpen,
    createProjectQuery,
    assigneeId,
    runAt,
    status,
    isRunAtModalOpen,
    setIsRunAtModalOpen,
    isSubmitting,
    submittedTagReceipt,
    createdTask,
    pendingUploadFiles,
    setPendingUploadFiles,
    markdownEditorRef,
    attachmentTriggerRef,
    attachmentUrls,
    handleAttachFiles,
    handleRemoveAttachment,
    mentionOptions,
    isSubmittingAny,
    handleCoworkerSelect,
    handleStatusSelect,
    handleCreateProject,
    handleProjectChange,
    handleProjectCreated,
    os,
    isMobile,
    selectedProject,
    isUploadingAttachments,
    hasRunAt,
    runAtLabel,
    isSaveDisabled,
    useWizard,
    step,
    setStep,
    showTaskStep,
    useComposeLayout,
    useModalFieldFill,
    taskStepTitle,
    statusPickerLabels,
    draftTags,
    selectedOption,
    isAgentAssignee,
    isQueuedSelectable,
    statusOptions,
    blocksOtherPeople,
    showPrivateControl,
    availableAssigneeOptions,
    isAssigneeLockedToAgent,
    showAssigneePicker,
    showModalCoworkerHeader,
    taskFieldsBorder,
    cardLabels,
    handleCancel,
    handleRunAtApply,
    handleRunAtClear,
    handleGoToTask,
    coworkerOptions,
    taskId,
    onSuccess,
    onCreateTask,
    router,
    canCreatePrivateTask,
    tNewTask,
    hasProjectSelection,
    originalStatus,
    copyOfTaskId,
    workspaceTagIds,
    setIsProjectMissing,
    knownSokoBotId,
    initialRunAt,
    setIsSubmitting,
    setSubmittedTagReceipt,
    setCreatedTask,
    canUseSubmitShortcut,
  };
}
