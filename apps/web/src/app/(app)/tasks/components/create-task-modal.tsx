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
import type { TaskAssigneeMemberOption } from "@/app/tasks/utils/task-assignee";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import {
  TaskForm,
  type TaskFormInitialDesignMdAttachment,
  taskAssigneeFormLabels,
} from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  assigneeOverrideId: string | null;
  projectOverrideId: string | null;
  promptOverride: string | null;
  formInstanceKey: number;
  handleOpen: () => void;
  /** Open the modal with an assignee preselected (and optionally a prefilled
   *  prompt), so the picker step is skipped. */
  handleOpenWith: (assigneeId: string, prompt?: string) => void;
  handleClose: () => void;
  clearPromptOverride: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  assigneeOverrideId: null,
  projectOverrideId: null,
  promptOverride: null,
  formInstanceKey: 0,
  handleOpen: () => {},
  handleOpenWith: () => {},
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
  const [projectOverrideId, setProjectOverrideId] = useState<string | null>(
    () =>
      initialOpen && initialProjectId != null && initialProjectId !== ""
        ? initialProjectId
        : null,
  );
  const [promptOverride, setPromptOverride] = useState<string | null>(() =>
    initialOpen && initialPrompt ? initialPrompt : null,
  );
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setAssigneeOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setPromptOverride(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleOpenWith = useCallback(
    (assigneeId: string, prompt?: string) => {
      setAssigneeOverrideId(assigneeId || null);
      setProjectOverrideId(initialProjectId || null);
      setPromptOverride(prompt ?? null);
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
        formInstanceKey,
        handleOpen,
        handleOpenWith,
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
  memberOptions?: TaskAssigneeMemberOption[];
  /** Omit to hide the project picker (e.g. when opened from the agents page). */
  projectOptions?: ProjectFilterOption[];
  defaultProjectId?: string | null;
  agentNameById?: Map<string, string>;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
  initialCreateTaskOpen?: boolean;
}

export function CreateTaskModal({
  coworkerOptions,
  memberOptions = [],
  projectOptions,
  defaultProjectId = null,
  agentNameById: initialAgentNameById,
  initialDesignMdAttachment: initialDesignMdAttachmentProp = null,
  initialCreateTaskOpen = false,
}: CreateTaskModalProps) {
  const {
    open,
    handleClose,
    assigneeOverrideId,
    projectOverrideId,
    promptOverride,
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
  const selectedProjectId = projectOverrideId ?? defaultProjectId ?? null;

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
    stripCreateTaskSearchParams();
    setIsCreated(false);
    handleClose();
  }, [handleClose, stripCreateTaskSearchParams]);

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
          projectSearchPlaceholder: t("projectSearchPlaceholder"),
          projectEmptyResults: t("projectEmptyResults"),
          projectCreate: t("projectCreate"),
          projectCreateNamed: t.raw("projectCreateNamed") as string,
          coworker: t("coworker"),
          coworkerDescription: t("coworkerDescription"),
          ...taskAssigneeFormLabels(t),
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
        memberOptions={memberOptions}
        projectOptions={projectOptions}
        agentNameById={agentNameById}
        initialDesignMdAttachment={initialDesignMdAttachment}
        initialValues={{
          ...(assigneeOverrideId ? { assigneeId: assigneeOverrideId } : {}),
          ...(promptOverride ? { description: promptOverride } : {}),
          projectId: selectedProjectId,
        }}
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
    </TaskFormModal>
  );
}
