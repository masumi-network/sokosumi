"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import type { ProjectSocialConnection } from "@/lib/clients/generated/core/types.gen";

import { ProjectForm, type ProjectFormLabels } from "./project-form";
import { ProjectSocialAccounts } from "./project-social-accounts";

interface ProjectEditModalProps {
  projectId: string;
  title: string;
  initialValues: {
    name: string;
    briefing: string;
    websiteUrl?: string | null;
  };
  labels: ProjectFormLabels;
  socialConnections: ProjectSocialConnection[];
}

export function ProjectEditModal({
  projectId,
  title,
  initialValues,
  labels,
  socialConnections,
}: ProjectEditModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isDismissDisabled, setIsDismissDisabled] = useState(false);

  const handleClose = useCallback(() => {
    router.replace(`/projects/${projectId}`);
  }, [projectId, router]);

  const isOpen = pathname === `/projects/${projectId}/edit`;

  return (
    <TaskFormModal
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
      title={title}
      cancelLabel={labels.cancel}
      isDismissDisabled={isDismissDisabled}
    >
      <ProjectForm
        mode="edit"
        variant="modal"
        showCancel={false}
        labels={labels}
        projectId={projectId}
        initialValues={initialValues}
        onCancel={handleClose}
        onSubmittingChange={setIsDismissDisabled}
        onSuccess={handleClose}
      >
        <ProjectSocialAccounts
          projectId={projectId}
          connections={socialConnections}
        />
      </ProjectForm>
    </TaskFormModal>
  );
}
