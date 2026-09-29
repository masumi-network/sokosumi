"use client";

import type { Project } from "@/lib/clients/generated/core/types.gen";

import { CreateProjectWizard } from "./create-project-wizard";
import type { ProjectCreationSource } from "./project-form";

interface InlineCreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated: (result: {
    projectId: string;
    name: string;
    project?: Project;
  }) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Where the project was made, for the "Project created" event. */
  creationSource?: ProjectCreationSource;
}

export function InlineCreateProjectModal({
  open,
  onOpenChange,
  initialName = "",
  onCreated,
  onCloseAutoFocus,
  creationSource = "task_form",
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
      creationSource={creationSource}
      onSuccess={handleSuccess}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}
