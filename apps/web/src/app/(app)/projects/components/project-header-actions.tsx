import { getTranslations } from "next-intl/server";

import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailPinButton } from "@/app/projects/components/project-detail-pin-button";
import { projectService } from "@/lib/services/project.service";

interface ProjectHeaderActionsProps {
  closedAt?: Date | string | null;
  closingAt?: Date | string | null;
  projectId: string;
  projectRevision?: number;
  scheduledSocialPostCount?: number;
}

/**
 * Pin and the project menu (Edit, Hide or Show, Close), beside the name on every project tab, so the
 * header does not change when the reader switches tabs.
 */
export async function ProjectHeaderActions({
  closedAt,
  closingAt,
  projectId,
  projectRevision,
  scheduledSocialPostCount = 0,
}: ProjectHeaderActionsProps) {
  const [t, tList, isHidden] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getTranslations("App.Projects.list"),
    // A failed read offers Hide, which Core treats as a no-op if it is Hidden.
    projectService.isProjectHidden(projectId).catch(() => false),
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
        // Muted like the unpinned Pin beside it, so the pair reads as one
        // quiet group and only a Pin's blue stands out.
        triggerClassName="text-muted-foreground"
        projectId={projectId}
        projectRevision={projectRevision}
        isClosingOrClosed={isClosingOrClosed}
        isHidden={isHidden}
        labels={{
          moreActions: t("actions.moreActions"),
          edit: t("actions.edit"),
          close: t("actions.close"),
          hide: {
            hide: tList("hide.hide"),
            show: tList("hide.show"),
            hidden: tList("hide.hidden"),
            undo: tList("hide.undo"),
            hideError: tList("hide.hideError"),
            showError: tList("hide.showError"),
          },
          closeDialog: {
            title: t("close.dialog.title"),
            description: t("close.dialog.description"),
            ...(scheduledSocialPostCount > 0
              ? {
                  scheduledPostsWarning: t(
                    "close.dialog.scheduledPostsWarning",
                    { count: scheduledSocialPostCount },
                  ),
                }
              : {}),
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
