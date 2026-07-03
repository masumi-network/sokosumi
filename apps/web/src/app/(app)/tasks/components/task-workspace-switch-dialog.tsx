"use client";

import * as Sentry from "@sentry/nextjs";
import type { SessionUser } from "@sokosumi/utils";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import HeaderWorkspaceAvatar from "@/app/components/header/header-workspace-avatar";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { OrganizationRecord } from "@/lib/clients/generated/core";

interface TaskWorkspaceSwitchDialogProps {
  currentAccountName: string;
  currentOrganization: OrganizationRecord | null;
  sessionUser: SessionUser;
  taskName: string;
  targetOrganization: OrganizationRecord | null;
  targetOrganizationId: string | null;
  targetAccountName: string;
  successMessage: string;
}

export function TaskWorkspaceSwitchDialog({
  currentAccountName,
  currentOrganization,
  sessionUser,
  taskName,
  targetOrganization,
  targetOrganizationId,
  targetAccountName,
  successMessage,
}: TaskWorkspaceSwitchDialogProps) {
  const t = useTranslations("App.Tasks.Detail.workspaceSwitchPrompt");
  const router = useRouter();
  const { handleSelectWorkspace, isPending } = useWorkspaceSwitcher();

  const handleCancel = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/tasks");
  };

  const handleSwitchWorkspace = async () => {
    try {
      await handleSelectWorkspace(targetOrganizationId, {
        shouldRedirectAgentJobsBasePath: false,
        shouldRedirectTaskDetailPath: false,
        successMessage,
      });
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          targetOrganizationId,
          taskName,
        },
        tags: { context: "task_workspace_switch_dialog" },
      });
      toast.error(t("switchError"));
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <div
            aria-label={t("avatarTransition", {
              currentAccount: currentAccountName,
              targetAccount: targetAccountName,
            })}
            className="flex items-center justify-center gap-3 py-2"
          >
            <HeaderWorkspaceAvatar
              className="size-10 md:size-10"
              logoSize={20}
              organization={currentOrganization}
              sessionUser={sessionUser}
            />
            <ArrowRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
            <HeaderWorkspaceAvatar
              className="size-10 md:size-10"
              logoSize={20}
              organization={targetOrganization}
              sessionUser={sessionUser}
            />
          </div>
          <AlertDialogDescription>
            {t.rich("description", {
              account: targetAccountName,
              accountName: (chunks: ReactNode) => (
                <span className="text-foreground font-semibold">{chunks}</span>
              ),
              taskName,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleCancel}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button disabled={isPending} onClick={handleSwitchWorkspace}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
