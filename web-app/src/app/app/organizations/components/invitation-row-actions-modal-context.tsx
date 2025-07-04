"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import { acceptInvitation, rejectInvitation } from "@/lib/actions";
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
      case InvitationRowAction.ACCEPT: {
        const result = await acceptInvitation(invitation.id);
        return { error: result.ok ? undefined : result.error };
      }
      case InvitationRowAction.REJECT: {
        const result = await rejectInvitation(invitation.id);
        return { error: result.ok ? undefined : result.error };
      }
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
