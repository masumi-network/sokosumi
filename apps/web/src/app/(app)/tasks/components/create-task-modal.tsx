"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState } from "react";

import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskForm } from "./task-form";
import { TaskFormModal } from "./task-form-modal";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  handleOpen: () => {},
  handleClose: () => {},
});

export function useCreateTaskModal() {
  return useContext(CreateTaskModalContext);
}

export function CreateTaskModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <CreateTaskModalContext.Provider value={{ open, handleOpen, handleClose }}>
      {children}
    </CreateTaskModalContext.Provider>
  );
}

// --- Modal ---

interface CreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
}

export function CreateTaskModal({ coworkerOptions }: CreateTaskModalProps) {
  const { open, handleClose } = useCreateTaskModal();
  const router = useRouter();
  const t = useTranslations("App.Tasks.NewTask");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);

  const handleOnOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) handleClose();
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
        onCancel={handleClose}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={(taskId) => {
          handleClose();
          router.push(`/tasks/${taskId}`);
        }}
      />
    </TaskFormModal>
  );
}
