"use client";

import { useTranslations } from "next-intl";
import {
  type WorkspaceSwitchAccounts,
  WorkspaceSwitchDialog,
  workspaceSwitchAccountName,
} from "@/app/components/user-avatar/workspace-switch-dialog";

export interface SeoWorkspaceSwitchDialogProps extends WorkspaceSwitchAccounts {
  auditName: string;
}

/** An Audit link opened in a workspace that does not hold the Audit: the switch keeps the link's address. */
export function SeoWorkspaceSwitchDialog({
  auditName,
  ...accounts
}: SeoWorkspaceSwitchDialogProps) {
  const t = useTranslations("App.Seo.workspaceSwitchPrompt");
  return (
    <WorkspaceSwitchDialog
      {...accounts}
      title={t("title")}
      description={t.rich("description", {
        account: accounts.targetAccountName,
        accountName: workspaceSwitchAccountName,
        auditName,
      })}
      stayHref="/seo"
      switchChoices={{ shouldRedirectSeoPath: false }}
      errorContext="seo_workspace_switch_dialog"
    />
  );
}
