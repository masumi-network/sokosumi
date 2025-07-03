"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import { authClient } from "@/lib/auth/auth.client";
import { InvitationWithRelations } from "@/lib/db";

export enum InvitationRowAction {
  ACCEPT = "ACCEPT",
  REJECT = "REJECT",
}

const {
  Provider: InvitationRowActionsModalContextProviderBase,
  useModalContext: useInvitationRowActionsModalContextBase,
} = createModalContext<InvitationWithRelations, InvitationRowAction>();

export function InvitationRowActionsModalContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("App.Organizations.InvitationActions");
  const router = useRouter();

  async function onAction(
    invitation: InvitationWithRelations,
    action: InvitationRowAction,
  ): Promise<{ error?: unknown }> {
    switch (action) {
      case InvitationRowAction.ACCEPT:
        return await authClient.organization.acceptInvitation({
          invitationId: invitation.id,
        });
      case InvitationRowAction.REJECT:
        return await authClient.organization.rejectInvitation({
          invitationId: invitation.id,
        });
    }
  }

  function onSuccess(action: InvitationRowAction) {
    switch (action) {
      case InvitationRowAction.ACCEPT:
        toast.success(t("acceptSuccess"));
        break;
      case InvitationRowAction.REJECT:
        toast.success(t("rejectSuccess"));
        break;
    }
    router.refresh();
  }

  function onError(action: InvitationRowAction, error: unknown) {
    console.error(`Failed to "${action}" invitation`, error);
    toast.error(
      action === InvitationRowAction.ACCEPT
        ? t("acceptError")
        : t("rejectError"),
    );
  }

  return (
    <InvitationRowActionsModalContextProviderBase
      onAction={onAction}
      onSuccess={onSuccess}
      onError={onError}
    >
      {children}
    </InvitationRowActionsModalContextProviderBase>
  );
}

export function useInvitationRowActionsModalContext() {
  return useInvitationRowActionsModalContextBase();
}
