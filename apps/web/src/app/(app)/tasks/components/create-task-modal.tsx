"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState } from "react";

import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getTaskAttachmentUploadLabelTemplate } from "./task-attachment-upload-labels";
import { TaskForm, type TaskFormInitialDesignMdAttachment } from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  coworkerOverrideId: string | null;
  projectOverrideId: string | null;
  promptOverride: string | null;
  formInstanceKey: number;
  handleOpen: () => void;
  /** Open the modal with a coworker preselected (and optionally a prefilled
   *  prompt), so the picker step is skipped. */
  handleOpenWith: (coworkerId: string, prompt?: string) => void;
  handleClose: () => void;
  clearPromptOverride: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  coworkerOverrideId: null,
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
  initialCoworkerId?: string | null;
  initialProjectId?: string | null;
  initialPrompt?: string | null;
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
  initialCoworkerId = null,
  initialProjectId = null,
  initialPrompt = null,
}: CreateTaskModalProviderProps) {
  const [open, setOpen] = useState(initialOpen);
  const [coworkerOverrideId, setCoworkerOverrideId] = useState<string | null>(
    () =>
      initialOpen && initialCoworkerId != null && initialCoworkerId !== ""
        ? initialCoworkerId
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
    setCoworkerOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setPromptOverride(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleOpenWith = useCallback(
    (coworkerId: string, prompt?: string) => {
      setCoworkerOverrideId(coworkerId || null);
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
        coworkerOverrideId,
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
  /** Omit to hide the project picker (e.g. when opened from the agents page). */
  projectOptions?: ProjectFilterOption[];
  defaultProjectId?: string | null;
  agentNameById: Map<string, string>;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
}

export function CreateTaskModal({
  coworkerOptions,
  projectOptions,
  defaultProjectId = null,
  agentNameById,
  initialDesignMdAttachment = null,
}: CreateTaskModalProps) {
  const {
    open,
    handleClose,
    coworkerOverrideId,
    projectOverrideId,
    promptOverride,
    formInstanceKey,
    clearPromptOverride,
  } = useCreateTaskModal();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("App.Tasks.NewTask");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);
  // True once the task is created and the success step is showing — the dismiss
  // button then means "close", not "cancel".
  const [isCreated, setIsCreated] = useState(false);
  // Bumped to remount the form with a clean slate for "Create another task".
  const [resetKey, setResetKey] = useState(0);
  const selectedProjectId = projectOverrideId ?? defaultProjectId ?? null;

  const stripCreateTaskSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (
      params.has("create") ||
      params.has("coworker") ||
      params.has("prompt")
    ) {
      params.delete("create");
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
          cancel: t("cancel"),
          ctrl: t("ctrl"),
          taskCreated: t("taskCreated"),
          taskCreatedHint: t("taskCreatedHint"),
          goToTask: t("goToTask"),
          createAnother: t("createAnother"),
        }}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        agentNameById={agentNameById}
        initialDesignMdAttachment={initialDesignMdAttachment}
        initialValues={{
          ...(coworkerOverrideId ? { coworkerId: coworkerOverrideId } : {}),
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
          setResetKey((key) => key + 1);
        }}
      />
    </TaskFormModal>
  );
}
