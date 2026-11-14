"use client";

import * as Sentry from "@sentry/nextjs";
import type { OrganizationRecord } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { WorkspaceAvatar } from "@/app/components/user-avatar/workspace-avatar";
import {
  useWorkspaceSwitcher,
  type WorkspaceSwitchChoices,
} from "@/app/components/user-avatar/workspace-switcher";
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

/** The accounts on both sides of a switch. A server page resolves them for its prompt. */
export interface WorkspaceSwitchAccounts {
  currentAccountName: string;
  currentOrganization: OrganizationRecord | null;
  sessionUser: SessionUser;
  targetOrganization: OrganizationRecord | null;
  targetOrganizationId: string | null;
  targetAccountName: string;
  successMessage: string;
}

interface WorkspaceSwitchDialogProps extends WorkspaceSwitchAccounts {
  title: string;
  description: ReactNode;
  /** Where the second button goes. With `stayBack`, only when there is no earlier page to go back to. */
  stayHref: string;
  /** The second button goes back to the earlier page when there is one. */
  stayBack?: boolean;
  /** The second button's text, when "Stay here" does not say what it opens. */
  stayLabel?: string;
  /** The path redirects of a switch to skip, so the opened link stays in the address. */
  switchChoices?: WorkspaceSwitchChoices;
  /** Sentry tag for a failed switch. */
  errorContext: string;
  errorExtra?: Record<string, unknown>;
}

/** The target account's name inside a prompt's description. */
export function workspaceSwitchAccountName(chunks: ReactNode) {
  return <span className="text-foreground font-semibold">{chunks}</span>;
}

/** Asks before a switch to the workspace that holds a linked item. The item itself is the caller's text. */
export function WorkspaceSwitchDialog({
  currentAccountName,
  currentOrganization,
  sessionUser,
  targetOrganization,
  targetOrganizationId,
  targetAccountName,
  successMessage,
  title,
  description,
  stayHref,
  stayBack = true,
  stayLabel,
  switchChoices,
  errorContext,
  errorExtra,
}: WorkspaceSwitchDialogProps) {
  // These texts name no task. The Tasks prompt had them first, so they stay there.
  const t = useTranslations("App.Tasks.Detail.workspaceSwitchPrompt");
  const router = useRouter();
  const { handleSelectWorkspace, isPending } = useWorkspaceSwitcher();

  const handleCancel = () => {
    if (stayBack && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(stayHref);
  };

  const handleSwitchWorkspace = async () => {
    try {
      await handleSelectWorkspace(targetOrganizationId, {
        ...switchChoices,
        successMessage,
      });
    } catch (error) {
      Sentry.captureException(error, {
        extra: { targetOrganizationId, ...errorExtra },
        tags: { context: errorContext },
      });
      toast.error(t("switchError"));
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <div
            aria-label={t("avatarTransition", {
              currentAccount: currentAccountName,
              targetAccount: targetAccountName,
            })}
            className="flex items-center justify-center gap-3 py-2"
          >
            <WorkspaceAvatar
              className="size-10 md:size-10"
              logoSize={20}
              organization={currentOrganization}
              sessionUser={sessionUser}
            />
            <ArrowRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
            <WorkspaceAvatar
              className="size-10 md:size-10"
              logoSize={20}
              organization={targetOrganization}
              sessionUser={sessionUser}
            />
          </div>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={handleCancel}>
            {stayLabel ?? t("cancel")}
          </AlertDialogCancel>
          <Button loading={isPending} onClick={handleSwitchWorkspace}>
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
