"use client";

import type { Project } from "@/lib/clients/generated/core/types.gen";

import { CreateProjectWizard } from "./create-project-wizard";

interface InlineCreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (result: {
    projectId: string;
    name: string;
    project?: Project;
  }) => void;
}

export function InlineCreateProjectModal({
  open,
  onOpenChange,
  initialName = "",
  onCreated,
}: InlineCreateProjectModalProps) {
  function handleSuccess(projectId: string, name: string, project?: Project) {
    onCreated({ projectId, name, project });
    onOpenChange(false);
  }

  if (!open) {
    return null;
  }

  return (
    <CreateProjectWizard
      key={initialName}
      open={open}
      onOpenChange={onOpenChange}
      initialName={initialName}
      creationSource="task_form"
      onSuccess={handleSuccess}
    />
  );
}
