"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { loadCreateTaskModalData } from "@/app/tasks/actions";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import {
  TaskForm,
  type TaskFormCreateHandler,
  type TaskFormInitialDesignMdAttachment,
} from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  assigneeOverrideId: string | null;
  /** `undefined` means no Calendar source was chosen yet, `null` the Workspace. */
  projectOverrideId: string | null | undefined;
  promptOverride: string | null;
  scheduleOverride: TaskScheduleSelection | null;
  formInstanceKey: number;
  handleOpen: () => void;
  /** Open the modal with an assignee preselected (and optionally a prefilled
   *  prompt), so the picker step is skipped. */
  handleOpenWith: (assigneeId: string, prompt?: string) => void;
  handleOpenWithDefaults: (defaults: {
    projectId?: string | null;
    schedule?: TaskScheduleSelection;
  }) => void;
  handleClose: () => void;
  clearPromptOverride: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  assigneeOverrideId: null,
  projectOverrideId: null,
  promptOverride: null,
  scheduleOverride: null,
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
  initialAssigneeId?: string | null;
  initialProjectId?: string | null;
  initialPrompt?: string | null;
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
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
  const [scheduleOverride, setScheduleOverride] =
    useState<TaskScheduleSelection | null>(null);
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setAssigneeOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setPromptOverride(null);
    setScheduleOverride(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleOpenWith = useCallback(
    (assigneeId: string, prompt?: string) => {
      setAssigneeOverrideId(assigneeId || null);
      setProjectOverrideId(initialProjectId || null);
      setPromptOverride(prompt ?? null);
      setScheduleOverride(null);
      setFormInstanceKey((key) => key + 1);
      setOpen(true);
    },
    [initialProjectId],
  );

  const handleOpenWithDefaults = useCallback(
    (defaults: {
      projectId?: string | null;
      schedule?: TaskScheduleSelection;
    }) => {
      const { schedule } = defaults;
      setAssigneeOverrideId(null);
      // A caller that omits `projectId` keeps the old default; the Calendar
      // passes it explicitly, including `undefined` for "nothing chosen yet".
      setProjectOverrideId(
        "projectId" in defaults ? defaults.projectId : initialProjectId || null,
      );
      setPromptOverride(null);
      setScheduleOverride(schedule ?? null);
      setFormInstanceKey((key) => key + 1);
      setOpen(true);
    },
    [initialProjectId],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

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
        scheduleOverride,
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

interface CreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
  /** Omit to hide the project picker (e.g. when opened from the agents page). */
  projectOptions?: ProjectFilterOption[];
  lockProjectSelection?: boolean;
  defaultProjectId?: string | null;
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
  agentNameById: initialAgentNameById,
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
    scheduleOverride,
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
  const [agentNameById, setAgentNameById] = useState(
    () => initialAgentNameById ?? new Map<string, string>(),
  );
  const [initialDesignMdAttachment, setInitialDesignMdAttachment] = useState(
    initialDesignMdAttachmentProp,
  );
  const hasLoadedCreateDataRef = useRef(
    Boolean(
      (initialAgentNameById && initialAgentNameById.size > 0) ||
        initialDesignMdAttachmentProp,
    ),
  );
  const selectedProjectId =
    projectOverrideId !== undefined ? projectOverrideId : defaultProjectId;

  useEffect(() => {
    if (!open && !initialCreateTaskOpen) return;
    if (hasLoadedCreateDataRef.current) return;

    let cancelled = false;
    void loadCreateTaskModalData()
      .then((data) => {
        if (cancelled) return;
        hasLoadedCreateDataRef.current = true;
        setAgentNameById(new Map(Object.entries(data.agentNameById)));
        if (data.designMdAttachment) {
          setInitialDesignMdAttachment(data.designMdAttachment);
        }
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(tTasksErrors("loadCreateTask"));
      });

    return () => {
      cancelled = true;
    };
  }, [initialCreateTaskOpen, open, tTasksErrors]);

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
          variant="modal"
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
            coworkerDescription: t("coworkerDescription"),
            chooseAgent: t("chooseAgent"),
            chooseAgentDescription: t("chooseAgentDescription"),
            defaultBadge: t("defaultBadge"),
            modelLabel: t("modelLabel"),
            hostingLabel: t("hostingLabel"),
            examplesTitle: t.raw("examplesTitle") as string,
            continueLabel: t("continue"),
            taskStepTitle: t.raw("taskStepTitle") as string,
            previousLabel: t("previousAgent"),
            nextLabel: t("nextAgent"),
            searchPlaceholder: t("searchAgents"),
            noResults: t("noAgentsFound"),
            askPrompt: t.raw("askPrompt") as string,
            promptHint: t("promptHint"),
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
            allCompanies: t("allCompanies"),
            status: t("status"),
            statusDescription: t("statusDescription"),
            statusDraft: t("statusDraft"),
            statusQueued: t("statusQueued"),
            statusReady: t("statusReady"),
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
            submit: t("saveDraft"),
            saveAsDraft: t("saveAsDraft"),
            createTask: t("createTask"),
            scheduleTask: t("scheduleTask"),
            openSchedule: t("openSchedule"),
            cancel: t("cancel"),
            ctrl: t("ctrl"),
            taskCreated: t("taskCreated"),
            taskCreatedHint: t("taskCreatedHint"),
            goToTask: t("goToTask"),
            createAnother: t("createAnother"),
          }}
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          lockProjectSelection={lockProjectSelection}
          agentNameById={agentNameById}
          initialDesignMdAttachment={initialDesignMdAttachment}
          initialValues={{
            ...(assigneeOverrideId ? { assigneeId: assigneeOverrideId } : {}),
            ...(promptOverride ? { description: promptOverride } : {}),
            projectId: selectedProjectId,
            ...(scheduleOverride ? { schedule: scheduleOverride } : {}),
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

function NewTaskWizardLoading() {
  return (
    <div
      aria-busy="true"
      data-testid="new-task-wizard-loading"
      className="flex flex-1 flex-col gap-6 px-6 py-6 md:px-8"
    >
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
