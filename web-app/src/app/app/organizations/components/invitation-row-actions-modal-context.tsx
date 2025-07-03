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
        const acceptResult = await authClient.organization.acceptInvitation({
          invitationId: invitation.id,
        });
        return { error: acceptResult.error };
      case InvitationRowAction.REJECT:
        const rejectResult = await authClient.organization.rejectInvitation({
          invitationId: invitation.id,
        });
        return { error: rejectResult.error };
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

  function onError(action: InvitationRowAction, _error: unknown) {
    switch (action) {
      case InvitationRowAction.ACCEPT:
        toast.error(t("acceptError"));
        break;
      case InvitationRowAction.REJECT:
        toast.error(t("rejectError"));
        break;
    }
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
