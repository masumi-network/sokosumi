"use client";

import { useTranslations } from "next-intl";
import {
  type WorkspaceSwitchAccounts,
  WorkspaceSwitchDialog,
  workspaceSwitchAccountName,
} from "@/app/components/user-avatar/workspace-switch-dialog";

interface TaskWorkspaceSwitchDialogProps extends WorkspaceSwitchAccounts {
  taskName: string;
}

export function TaskWorkspaceSwitchDialog({
  taskName,
  ...accounts
}: TaskWorkspaceSwitchDialogProps) {
  const t = useTranslations("App.Tasks.Detail.workspaceSwitchPrompt");
  return (
    <WorkspaceSwitchDialog
      {...accounts}
      title={t("title")}
      description={t.rich("description", {
        account: accounts.targetAccountName,
        accountName: workspaceSwitchAccountName,
        taskName,
      })}
      stayHref="/tasks"
      switchChoices={{
        shouldRedirectAgentJobsBasePath: false,
        shouldRedirectTaskDetailPath: false,
      }}
      errorContext="task_workspace_switch_dialog"
      errorExtra={{ taskName }}
    />
  );
}
