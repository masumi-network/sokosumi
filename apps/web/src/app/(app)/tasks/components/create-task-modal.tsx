"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState } from "react";

import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskForm } from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  coworkerOverrideId: string | null;
  formInstanceKey: number;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  coworkerOverrideId: null,
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
}

export function CreateTaskModalProvider({
  children,
  initialOpen = false,
  initialCoworkerId = null,
}: CreateTaskModalProviderProps) {
  const [open, setOpen] = useState(initialOpen);
  const [coworkerOverrideId, setCoworkerOverrideId] = useState<string | null>(
    () =>
      initialOpen && initialCoworkerId != null && initialCoworkerId !== ""
        ? initialCoworkerId
        : null,
  );
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setCoworkerOverrideId(null);
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <CreateTaskModalContext.Provider
      value={{
        open,
        coworkerOverrideId,
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
  agentNameById: Map<string, string>;
}

export function CreateTaskModal({
  coworkerOptions,
  agentNameById,
}: CreateTaskModalProps) {
  const { open, handleClose, coworkerOverrideId, formInstanceKey } =
    useCreateTaskModal();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("App.Tasks.NewTask");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);

  const stripCreateTaskSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("create") || params.has("coworker")) {
      router.replace(pathname);
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
          coworker: t("coworker"),
          coworkerDescription: t("coworkerDescription"),
          status: t("status"),
          statusDescription: t("statusDescription"),
          statusDraft: t("statusDraft"),
          statusReady: t("statusReady"),
          back: t("back"),
          uploadFile: t("uploadFile"),
          uploadFileError: t("uploadFileError"),
          removeAttachment: t("removeAttachment"),
          submit: t("saveDraft"),
          saveAsDraft: t("saveAsDraft"),
          createTask: t("createTask"),
          cancel: t("cancel"),
          ctrl: t("ctrl"),
        }}
        coworkerOptions={coworkerOptions}
        agentNameById={agentNameById}
        initialValues={
          coworkerOverrideId ? { coworkerId: coworkerOverrideId } : undefined
        }
        onCancel={handleDismiss}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={(taskId) => {
          handleDismiss();
          router.push(`/tasks/${taskId}`);
        }}
      />
    </TaskFormModal>
  );
}
