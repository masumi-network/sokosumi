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
  formInstanceKey: number;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  coworkerOverrideId: null,
  projectOverrideId: null,
  formInstanceKey: 0,
  handleOpen: () => {},
  handleClose: () => {},
});

export function useCreateTaskModal() {
  return useContext(CreateTaskModalContext);
}

interface CreateTaskModalProviderProps {
  children: React.ReactNode;
  initialOpen?: boolean;
  initialCoworkerId?: string | null;
  initialProjectId?: string | null;
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
  initialCoworkerId = null,
  initialProjectId = null,
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
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setCoworkerOverrideId(null);
    setProjectOverrideId(initialProjectId || null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, [initialProjectId]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <CreateTaskModalContext.Provider
      value={{
        open,
        coworkerOverrideId,
        projectOverrideId,
        formInstanceKey,
        handleOpen,
        handleClose,
      }}
    >
      {children}
    </CreateTaskModalContext.Provider>
  );
}

// --- Modal ---

interface CreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
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
    formInstanceKey,
  } = useCreateTaskModal();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("App.Tasks.NewTask");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);
  const selectedProjectId = projectOverrideId ?? defaultProjectId ?? null;

  const stripCreateTaskSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("create") || params.has("coworker")) {
      params.delete("create");
      params.delete("coworker");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    }
  }, [pathname, router]);

  const handleDismiss = useCallback(() => {
    stripCreateTaskSearchParams();
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
      cancelLabel={t("cancel")}
      isDismissDisabled={isDismissDisabled}
    >
      <TaskForm
        key={formInstanceKey}
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
        }}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        agentNameById={agentNameById}
        initialDesignMdAttachment={initialDesignMdAttachment}
        initialValues={{
          ...(coworkerOverrideId ? { coworkerId: coworkerOverrideId } : {}),
          projectId: selectedProjectId,
        }}
        onCancel={handleDismiss}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={(taskId) => {
          handleClose();
          router.push(`/tasks/${taskId}`);
        }}
      />
    </TaskFormModal>
  );
}
