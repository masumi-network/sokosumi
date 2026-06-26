"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";

import { ProjectForm } from "./project-form";

interface CreateProjectModalContextType {
  open: boolean;
  formInstanceKey: number;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateProjectModalContext = createContext<CreateProjectModalContextType>({
  open: false,
  formInstanceKey: 0,
  handleOpen: () => {},
  handleClose: () => {},
});

export function useCreateProjectModal() {
  return useContext(CreateProjectModalContext);
}

interface CreateProjectModalProviderProps {
  children: React.ReactNode;
  initialOpen?: boolean;
}

export function CreateProjectModalProvider({
  children,
  initialOpen = false,
}: CreateProjectModalProviderProps) {
  const [open, setOpen] = useState(initialOpen);
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const handleOpen = useCallback(() => {
    setFormInstanceKey((key) => key + 1);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <CreateProjectModalContext.Provider
      value={{
        open,
        formInstanceKey,
        handleOpen,
        handleClose,
      }}
    >
      {children}
    </CreateProjectModalContext.Provider>
  );
}

export function CreateProjectModal() {
  const { open, handleClose, formInstanceKey } = useCreateProjectModal();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("App.Projects");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);

  const stripCreateProjectSearchParams = useCallback(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (!params.has("create")) return;

    params.delete("create");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router]);

  const handleDismiss = useCallback(() => {
    stripCreateProjectSearchParams();
    handleClose();
  }, [handleClose, stripCreateProjectSearchParams]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) handleDismiss();
  }

  function handleSuccess() {
    handleClose();
    stripCreateProjectSearchParams();
    router.refresh();
  }

  return (
    <TaskFormModal
      open={open}
      onOpenChange={handleOpenChange}
      title={t("NewProject.title")}
      cancelLabel={t("NewProject.cancel")}
      isDismissDisabled={isDismissDisabled}
    >
      <ProjectForm
        key={formInstanceKey}
        mode="create"
        variant="modal"
        creationSource="projects_page"
        showCancel={false}
        labels={{
          details: t("NewProject.details"),
          detailsDescription: t("NewProject.detailsDescription"),
          name: t("NewProject.name"),
          namePlaceholder: t("NewProject.namePlaceholder"),
          description: t("NewProject.description"),
          descriptionPlaceholder: t("NewProject.descriptionPlaceholder"),
          submit: t("NewProject.createProject"),
          cancel: t("NewProject.cancel"),
          error: t("Detail.errors.create"),
        }}
        onCancel={handleDismiss}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={handleSuccess}
      />
    </TaskFormModal>
  );
}
