"use client";

import { useTranslations } from "next-intl";
import {
  type WorkspaceSwitchAccounts,
  WorkspaceSwitchDialog,
  workspaceSwitchAccountName,
} from "@/app/components/user-avatar/workspace-switch-dialog";
import { SEO_ADD_PAGE_HREF } from "../seo-href";

export interface SeoWorkspaceSwitchDialogProps extends WorkspaceSwitchAccounts {
  auditName: string;
}

/** An Audit open in a workspace that does not hold it: switch to its workspace, or start in this one. */
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
      // The earlier page can be the same Audit, so this button always opens the form for a new Audit.
      stayHref={SEO_ADD_PAGE_HREF}
      stayBack={false}
      stayLabel={t("stay")}
      errorContext="seo_workspace_switch_dialog"
    />
  );
}
