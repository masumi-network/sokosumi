"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";

import { loadCreateTaskModalData } from "@/app/tasks/actions";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";
import type { CoworkerOption } from "@/lib/types/coworker";

import { AgentSpotlightSkeleton } from "./agent-spotlight";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import {
  TaskForm,
  type TaskFormCreateHandler,
  type TaskFormInitialDesignMdAttachment,
} from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

/** A Calendar slot's Run at, as a local date-time in the Calendar's timezone. */
export interface RunAtPrefill {
  localIso: string;
  timezone: string;
}

interface CreateTaskModalContextType {
  open: boolean;
  assigneeOverrideId: string | null;
  /** `undefined` means no Calendar source was chosen yet, `null` the Workspace. */
  projectOverrideId: string | null | undefined;
  promptOverride: string | null;
  runAtOverride: RunAtPrefill | null;
  formInstanceKey: number;
  handleOpen: () => void;
  /** Open the modal with an assignee preselected (and optionally a prefilled
   *  prompt), so the picker step is skipped. */
  handleOpenWith: (assigneeId: string, prompt?: string) => void;
  handleOpenWithDefaults: (defaults: {
    projectId?: string | null;
    runAt?: RunAtPrefill;
  }) => void;
  handleClose: () => void;
  clearPromptOverride: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  assigneeOverrideId: null,
  projectOverrideId: null,
  promptOverride: null,
  runAtOverride: null,
  formInstanceKey: 0,
  handleOpen: () => {},
  handleOpenWith: () => {},
  handleOpenWithDefaults: () => {},
  handleClose: () => {},
  clearPromptOverride: () => {},
});

export function useCreateTaskModal() {
  return useContext(CreateTaskModalContext);
}

interface CreateTaskModalProviderProps {
  children: React.ReactNode;
  initialOpen?: boolean;
  /** Runs whenever the modal closes (dismiss, load error, or success). */
  onClose?: () => void;
  initialAssigneeId?: string | null;
  initialProjectId?: string | null;
  initialPrompt?: string | null;
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
  onClose,
  initialAssigneeId = null,
  initialProjectId = null,
  initialPrompt = null,
}: CreateTaskModalProviderProps) {
  const [open, setOpen] = useState(initialOpen);
  const [assigneeOverrideId, setAssigneeOverrideId] = useState<string | null>(
    () =>
      initialOpen && initialAssigneeId != null && initialAssigneeId !== ""
        ? initialAssigneeId
        : null,
  );
  const [projectOverrideId, setProjectOverrideId] = useState<
    string | null | undefined
  >(() =>
    initialOpen && initialProjectId != null && initialProjectId !== ""
      ? initialProjectId
      : null,
  );
  const [promptOverride, setPromptOverride] = useState<string | null>(() =>
    initialOpen && initialPrompt ? initialPrompt : null,
  );
  const [runAtOverride, setRunAtOverride] = useState<RunAtPrefill | null>(null);
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setAssigneeOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setPromptOverride(null);
    setRunAtOverride(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleOpenWith = useCallback(
    (assigneeId: string, prompt?: string) => {
      setAssigneeOverrideId(assigneeId || null);
      setProjectOverrideId(initialProjectId || null);
      setPromptOverride(prompt ?? null);
      setRunAtOverride(null);
      setFormInstanceKey((key) => key + 1);
      setOpen(true);
    },
    [initialProjectId],
  );

  const handleOpenWithDefaults = useCallback(
    (defaults: { projectId?: string | null; runAt?: RunAtPrefill }) => {
      setAssigneeOverrideId(null);
      // A caller that omits `projectId` keeps the old default; the Calendar
      // passes it explicitly, including `undefined` for "nothing chosen yet".
      setProjectOverrideId(
        "projectId" in defaults ? defaults.projectId : initialProjectId || null,
      );
      setPromptOverride(null);
      setRunAtOverride(defaults.runAt ?? null);
      setFormInstanceKey((key) => key + 1);
      setOpen(true);
    },
    [initialProjectId],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const clearPromptOverride = useCallback(() => {
    setPromptOverride(null);
  }, []);

  return (
    <CreateTaskModalContext.Provider
      value={{
        open,
        assigneeOverrideId,
        projectOverrideId,
        promptOverride,
        runAtOverride,
        formInstanceKey,
        handleOpen,
        handleOpenWith,
        handleOpenWithDefaults,
        handleClose,
        clearPromptOverride,
      }}
    >
      {children}
    </CreateTaskModalContext.Provider>
  );
}

// --- Modal ---

function runAtPrefillToIso(runAt: RunAtPrefill | null): string | null {
  if (!runAt) return null;
  return (
    zonedDateTimeLocalToUtc(runAt.localIso, runAt.timezone)?.toISOString() ??
    null
  );
}

interface LoadedCreateData {
  agentNameById: Map<string, string>;
  designMdAttachment: TaskFormInitialDesignMdAttachment | null;
  projectOptions: ProjectFilterOption[];
}

interface CreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
  /** Omit to load workspace projects after open (agents gallery). Pass `[]` to show an empty chip without fetching. */
  projectOptions?: ProjectFilterOption[];
  lockProjectSelection?: boolean;
  defaultProjectId?: string | null;
  /** A caller that passes this owns the create data (agent names and
   *  design.md) and the modal does not load it itself. */
  agentNameById?: Map<string, string>;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  initialCreateTaskOpen?: boolean;
  /** Shows a skeleton instead of the form while the caller still loads
   *  `coworkerOptions` / `projectOptions` (the sidebar New Task wizard). */
  isLoadingOptions?: boolean;
  onCreateTask?: TaskFormCreateHandler;
}

export function CreateTaskModal({
  coworkerOptions,
  projectOptions,
  lockProjectSelection = false,
  defaultProjectId,
  agentNameById: agentNameByIdProp,
  initialDesignMdAttachment: initialDesignMdAttachmentProp = null,
  initialCreateTaskOpen = false,
  isLoadingOptions = false,
  onCreateTask,
}: CreateTaskModalProps) {
  const {
    open,
    handleClose,
    assigneeOverrideId,
    projectOverrideId,
    promptOverride,
    runAtOverride,
    formInstanceKey,
    clearPromptOverride,
  } = useCreateTaskModal();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("App.Tasks.NewTask");
  const tTasksErrors = useTranslations("App.Tasks.Errors");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);
  // True once the task is created and the success step is showing — the dismiss
  // button then means "close", not "cancel".
  const [isCreated, setIsCreated] = useState(false);
  // Bumped to remount the form with a clean slate for "Create another task".
  const [resetKey, setResetKey] = useState(0);
  const ownsCreateData = agentNameByIdProp !== undefined;
  const [loadedCreateData, setLoadedCreateData] =
    useState<LoadedCreateData | null>(null);
  const agentNameById = agentNameByIdProp ?? loadedCreateData?.agentNameById;
  const initialDesignMdAttachment =
    initialDesignMdAttachmentProp ??
    loadedCreateData?.designMdAttachment ??
    null;
  const resolvedProjectOptions =
    projectOptions ?? loadedCreateData?.projectOptions;
  const selectedProjectId =
    projectOverrideId !== undefined ? projectOverrideId : defaultProjectId;

  useEffect(() => {
    if (ownsCreateData || isLoadingOptions) return;
    if (!open && !initialCreateTaskOpen) return;
    if (loadedCreateData) return;

    let cancelled = false;
    void loadCreateTaskModalData()
      .then((data) => {
        if (cancelled) return;
        setLoadedCreateData({
          agentNameById: new Map(Object.entries(data.agentNameById)),
          designMdAttachment: data.designMdAttachment,
          projectOptions: data.projectOptions,
        });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(tTasksErrors("loadCreateTask"));
      });

    return () => {
      cancelled = true;
    };
  }, [
    initialCreateTaskOpen,
    isLoadingOptions,
    loadedCreateData,
    open,
    ownsCreateData,
    tTasksErrors,
  ]);

  const stripCreateTaskSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (
      params.has("create") ||
      params.has("assignee") ||
      params.has("coworker") ||
      params.has("prompt")
    ) {
      params.delete("create");
      params.delete("assignee");
      params.delete("coworker");
      params.delete("prompt");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    }
  }, [pathname, router]);

  const handleDismiss = useCallback(() => {
    // Only the `?create=true` deep link put those params in the URL; a wizard
    // opened in place must leave the page's own URL alone.
    if (initialCreateTaskOpen) stripCreateTaskSearchParams();
    setIsCreated(false);
    handleClose();
  }, [handleClose, initialCreateTaskOpen, stripCreateTaskSearchParams]);

  const handleOnOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) handleDismiss();
  };

  return (
    <TaskFormModal
      open={open}
      onOpenChange={handleOnOpenChange}
      title={t("title")}
      cancelLabel={isCreated ? t("close") : t("cancel")}
      isDismissDisabled={isDismissDisabled}
    >
      {isLoadingOptions ? (
        <NewTaskWizardLoading />
      ) : (
        <TaskForm
          key={`${formInstanceKey}-${resetKey}`}
          mode="create"
          showCancel={false}
          labels={{
            details: t("details"),
            detailsDescription: t("detailsDescription"),
            name: t("name"),
            namePlaceholder: t("namePlaceholder"),
            descriptionPlaceholder: t("descriptionPlaceholder"),
            projectLabel: t("projectLabel"),
            projectNone: t("projectNone"),
            projectPlaceholder: t("projectPlaceholder"),
            projectRequired: t("projectRequired"),
            projectSearchPlaceholder: t("projectSearchPlaceholder"),
            projectEmptyResults: t("projectEmptyResults"),
            projectCreate: t("projectCreate"),
            projectCreateNamed: t.raw("projectCreateNamed") as string,
            coworker: t("coworker"),
            unassigned: t("unassigned"),
            unavailableAssignee: t("unavailableAssignee"),
            changeCoworker: t("changeCoworker"),
            noCoworkerMatches: t("noCoworkerMatches"),
            defaultBadge: t("defaultBadge"),
            modelLabel: t("modelLabel"),
            hostingLabel: t("hostingLabel"),
            taskStepTitle: t.raw("taskStepTitle") as string,
            noResults: t("noAgentsFound"),
            tasksTitle: t.has("tasksTitle")
              ? t("tasksTitle")
              : "Ready-To-Run Tasks",
            startFromScratch: t.has("startFromScratch")
              ? t("startFromScratch")
              : "Start from scratch",
            startFromScratchHint: t.has("startFromScratchHint")
              ? t("startFromScratchHint")
              : "Write your own instructions",
            previewExample: t.has("previewExample")
              ? t("previewExample")
              : "Preview example",
            previewUse: t.has("previewUse") ? t("previewUse") : "Use this task",
            previewEmpty: t.has("previewEmpty")
              ? t("previewEmpty")
              : "No example output available yet.",
            status: t("status"),
            statusDescription: t("statusDescription"),
            statusDraft: t("statusDraft"),
            changeStatus: t("changeStatus"),
            noStatusMatches: t("noStatusMatches"),
            statusQueued: t("statusQueued"),
            statusReady: t("statusReady"),
            untitledTask: t("untitledTask"),
            saveError: t("saveError"),
            back: t("back"),
            uploadFile: t("uploadFile"),
            uploadFileError: t("uploadFileError"),
            uploadingFile: getTaskAttachmentUploadLabelTemplate(
              t,
              "uploadingFile",
            ),
            uploadingFiles: getTaskAttachmentUploadLabelTemplate(
              t,
              "uploadingFiles",
            ),
            removeAttachment: t("removeAttachment"),
            submit: t("createTask"),
            createTask: t("createTask"),
            scheduleTask: t("scheduleTask"),
            openRunAt: t("openRunAt"),
            cancel: t("cancel"),
            ctrl: t("ctrl"),
            taskCreated: t("taskCreated"),
            taskCreatedHint: t("taskCreatedHint"),
            goToTask: t("goToTask"),
            createAnother: t("createAnother"),
            privateLabel: t("privateLabel"),
            privateDescription: t("privateDescription"),
          }}
          coworkerOptions={coworkerOptions}
          projectOptions={resolvedProjectOptions}
          lockProjectSelection={lockProjectSelection}
          agentNameById={agentNameById}
          initialDesignMdAttachment={initialDesignMdAttachment}
          initialValues={{
            ...(assigneeOverrideId ? { assigneeId: assigneeOverrideId } : {}),
            ...(promptOverride ? { description: promptOverride } : {}),
            projectId: selectedProjectId,
            runAt: runAtPrefillToIso(runAtOverride),
          }}
          onCreateTask={onCreateTask}
          onCancel={handleDismiss}
          onSubmittingChange={setIsDismissDisabled}
          onCreatedChange={setIsCreated}
          onCreated={() => {
            router.refresh();
          }}
          onSuccess={(taskId) => {
            handleClose();
            router.push(`/tasks/${taskId}`);
          }}
          onCreateAnother={() => {
            clearPromptOverride();
            setIsCreated(false);
            setResetKey((key) => key + 1);
          }}
        />
      )}
    </TaskFormModal>
  );
}

// Same wrapper as the wizard's first step, so the skeleton sits exactly where
// the spotlight will.
function NewTaskWizardLoading() {
  const tTasks = useTranslations("App.Tasks");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={tTasks("Actions.loading")}
      data-testid="new-task-wizard-loading"
      className="flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8 md:py-0"
    >
      <AgentSpotlightSkeleton />
    </div>
  );
}
