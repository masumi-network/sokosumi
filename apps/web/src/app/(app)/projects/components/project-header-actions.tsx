import { getTranslations } from "next-intl/server";

import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailPinButton } from "@/app/projects/components/project-detail-pin-button";

interface ProjectHeaderActionsProps {
  closedAt?: Date | string | null;
  closingAt?: Date | string | null;
  projectId: string;
  projectRevision?: number;
}

/**
 * Pin and the project menu, beside the name on every project tab, so the
 * header does not change when the reader switches tabs.
 */
export async function ProjectHeaderActions({
  closedAt,
  closingAt,
  projectId,
  projectRevision,
}: ProjectHeaderActionsProps) {
  const [t, tList] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getTranslations("App.Projects.list"),
  ]);
  const isClosingOrClosed = Boolean(closingAt || closedAt);

  return (
    <div className="flex items-center gap-2">
      <ProjectDetailPinButton
        projectId={projectId}
        isClosed={isClosingOrClosed}
        labels={{
          pin: tList("pin"),
          unpin: tList("unpin"),
          error: tList("pinError"),
        }}
      />
      <ProjectDetailActions
        projectId={projectId}
        projectRevision={projectRevision}
        isClosingOrClosed={isClosingOrClosed}
        labels={{
          moreActions: t("actions.moreActions"),
          edit: t("actions.edit"),
          close: t("actions.close"),
          closeDialog: {
            title: t("close.dialog.title"),
            description: t("close.dialog.description"),
            reasonLabel: t("close.dialog.reasonLabel"),
            reasonPlaceholder: t("close.dialog.reasonPlaceholder"),
            confirm: t("close.dialog.confirm"),
            cancel: t("close.dialog.cancel"),
            success: t("close.dialog.success"),
            error: t("close.dialog.error"),
          },
        }}
      />
    </div>
  );
}
