"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";

import { ProjectForm } from "./project-form";

interface InlineCreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (result: { projectId: string; name: string }) => void;
}

export function InlineCreateProjectModal({
  open,
  onOpenChange,
  initialName = "",
  onCreated,
}: InlineCreateProjectModalProps) {
  const t = useTranslations("App.Projects");
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);

  function handleSuccess(projectId: string, name: string) {
    onCreated({ projectId, name });
    onOpenChange(false);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setIsDismissDisabled(false);
    }
    onOpenChange(nextOpen);
  }

  return (
    <TaskFormModal
      open={open}
      onOpenChange={handleOpenChange}
      title={t("NewProject.title")}
      cancelLabel={t("NewProject.cancel")}
      isDismissDisabled={isDismissDisabled}
    >
      {open ? (
        <ProjectForm
          key={initialName}
          mode="create"
          variant="modal"
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
          initialValues={{
            name: initialName,
          }}
          onCancel={handleCancel}
          onSubmittingChange={setIsDismissDisabled}
          onSuccess={handleSuccess}
        />
      ) : null}
    </TaskFormModal>
  );
}
