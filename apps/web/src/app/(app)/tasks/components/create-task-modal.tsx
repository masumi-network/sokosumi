"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { taskHref } from "@/app/tasks/utils/task-href";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateTaskModalData } from "@/hooks/effects/use-create-task-modal-data";
import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";
import type { CoworkerOption } from "@/lib/types/coworker";
import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import {
  TaskForm,
  type TaskFormCreateHandler,
  type TaskFormInitialDesignMdAttachment,
} from "./task-form";
import { TaskFormModal } from "./task-form-modal";
import type { TaskFormTagPrefill } from "./task-form-types";
import { storeTasksReturnPath } from "./task-navigation";

// --- Context ---

/** A Calendar slot's Run at, as a local date-time in the Calendar's timezone. */
export interface RunAtPrefill {
  localIso: string;
  timezone: string;
}

/** What a copy of an existing Task carries beyond prompt and project. Its
 *  assignee keeps its kind, and none stays none. A copy always starts as a
 *  Draft, so nothing runs before review. */
export interface NewTaskCopyPrefill extends TaskFormTagPrefill {
  taskId: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
}

interface CreateTaskModalContextType {
  open: boolean;
  assigneeOverrideId: string | null;
  /** `undefined` means no Calendar source was chosen yet, `null` the Workspace. */
  projectOverrideId: string | null | undefined;
  promptOverride: string | null;
  runAtOverride: RunAtPrefill | null;
  copyOverride: NewTaskCopyPrefill | null;
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
  /** Told the new task's id; a chat commitment closes its loop with it. */
  onTaskCreated?: (taskId: string) => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  assigneeOverrideId: null,
  projectOverrideId: null,
  promptOverride: null,
  runAtOverride: null,
  copyOverride: null,
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
  initialCopy?: NewTaskCopyPrefill | null;
  onTaskCreated?: (taskId: string) => void;
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
  onClose,
  initialAssigneeId = null,
  initialProjectId = null,
  initialPrompt = null,
  initialCopy = null,
  onTaskCreated,
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
  const [copyOverride, setCopyOverride] = useState<NewTaskCopyPrefill | null>(
    () => (initialOpen ? initialCopy : null),
  );
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setAssigneeOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setPromptOverride(null);
    setRunAtOverride(null);
    setCopyOverride(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleOpenWith = useCallback(
    (assigneeId: string, prompt?: string) => {
      setAssigneeOverrideId(assigneeId || null);
      setProjectOverrideId(initialProjectId || null);
      setPromptOverride(prompt ?? null);
      setRunAtOverride(null);
      setCopyOverride(null);
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
      setCopyOverride(null);
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
    setCopyOverride(null);
  }, []);

  return (
    <CreateTaskModalContext.Provider
      value={{
        open,
        assigneeOverrideId,
        projectOverrideId,
        promptOverride,
        runAtOverride,
        copyOverride,
        formInstanceKey,
        handleOpen,
        handleOpenWith,
        handleOpenWithDefaults,
        handleClose,
        clearPromptOverride,
        onTaskCreated,
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
    copyOverride,
    formInstanceKey,
    clearPromptOverride,
    onTaskCreated,
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
  const hasTypedTextRef = useRef(false);
  const ownsCreateData = agentNameByIdProp !== undefined;
  const loadedCreateData = useCreateTaskModalData({
    ownsCreateData,
    isLoadingOptions,
    open,
    initialCreateTaskOpen,
    tTasksErrors,
  });
  const agentNameById = agentNameByIdProp ?? loadedCreateData?.agentNameById;
  const initialDesignMdAttachment =
    initialDesignMdAttachmentProp ??
    loadedCreateData?.designMdAttachment ??
    null;
  const resolvedProjectOptions =
    projectOptions ?? loadedCreateData?.projectOptions;
  const selectedProjectId =
    projectOverrideId !== undefined ? projectOverrideId : defaultProjectId;

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
    hasTypedTextRef.current = false;
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
      variant="composer"
      hasUnsavedText={() => !isCreated && hasTypedTextRef.current}
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
            status: t("status"),
            statusDescription: t("statusDescription"),
            statusDraft: t("statusDraft"),
            changeStatus: t("changeStatus"),
            noStatusMatches: t("noStatusMatches"),
            statusQueued: t("statusQueued"),
            statusReady: t("statusReady"),
            untitledTask: t("untitledTask"),
            saveError: t("saveError"),
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
            taskCreatedHint: {
              DRAFT: t("taskCreatedHint", { status: "DRAFT" }),
              QUEUED: t("taskCreatedHint", { status: "QUEUED" }),
              READY: t("taskCreatedHint", { status: "READY" }),
            },
            goToTask: t("goToTask"),
            createAnother: t("createAnother"),
            privateLabel: t("privateLabel"),
            privateDescription: t("privateDescription"),
            privateOtherPeopleHint: t("privateOtherPeopleHint"),
          }}
          coworkerOptions={coworkerOptions}
          projectOptions={resolvedProjectOptions}
          lockProjectSelection={lockProjectSelection}
          agentNameById={agentNameById}
          initialDesignMdAttachment={initialDesignMdAttachment}
          initialValues={{
            ...(assigneeOverrideId ? { assigneeId: assigneeOverrideId } : {}),
            ...(promptOverride ? { description: promptOverride } : {}),
            ...(copyOverride
              ? {
                  tags: copyOverride.tags,
                  workspaceTags: copyOverride.workspaceTags,
                  copyOfTaskId: copyOverride.taskId,
                  name: copyOverride.name,
                  visibility: copyOverride.visibility,
                  status: TaskStatus.DRAFT,
                  assigneeId: copyOverride.assigneeId,
                  assigneeSokoBotId: copyOverride.assigneeSokoBotId,
                  assigneeUserId: copyOverride.assigneeUserId,
                }
              : {}),
            projectId: selectedProjectId,
            runAt: runAtPrefillToIso(runAtOverride),
          }}
          onCreateTask={onCreateTask}
          onCancel={handleDismiss}
          onSubmittingChange={setIsDismissDisabled}
          onDirtyChange={(dirty) => {
            hasTypedTextRef.current = dirty;
          }}
          onCreatedChange={setIsCreated}
          // No router.refresh() here: `createTask` calls revalidatePath, so its
          // response already carries the current page. A refresh on top holds
          // that render back until a second full page render ends. A custom
          // `onCreateTask` must revalidate too, or the page never updates.
          onCreated={onTaskCreated}
          onSuccess={(task) => {
            storeTasksReturnPath();
            setIsCreated(false);
            handleClose();
            router.push(taskHref(task));
          }}
          onCreateAnother={() => {
            hasTypedTextRef.current = false;
            clearPromptOverride();
            setIsCreated(false);
            setResetKey((key) => key + 1);
          }}
        />
      )}
    </TaskFormModal>
  );
}

// The composer's shape, so nothing jumps when the lists arrive.
function NewTaskWizardLoading() {
  const tTasks = useTranslations("App.Tasks");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={tTasks("Actions.loading")}
      data-testid="new-task-wizard-loading"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex-1 space-y-4 px-5 pt-2 pb-3 md:px-6">
        <Skeleton className="h-7 w-2/5" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="flex gap-1.5 px-5 pb-3 md:px-6">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <div className="flex items-center justify-end border-t px-5 py-3 md:px-6">
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}
