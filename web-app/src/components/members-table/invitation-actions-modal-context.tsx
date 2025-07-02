"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import { authClient } from "@/lib/auth/auth.client";
import { Invitation } from "@/prisma/generated/client";

export enum InvitationAction {
  CANCEL = "CANCEL",
}

const {
  Provider: InvitationActionsModalContextProviderBase,
  useModalContext: useInvitationActionsModalContextBase,
} = createModalContext<Invitation, InvitationAction>();

export function InvitationActionsModalContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations(
    "Components.MembersTable.InvitationActions.CancelModal",
  );
  const router = useRouter();

  async function onAction(
    invitation: Invitation,
    action: InvitationAction,
  ): Promise<{ error?: unknown }> {
    switch (action) {
      case InvitationAction.CANCEL:
        const result = await authClient.organization.cancelInvitation({
          invitationId: invitation.id,
        });
        return { error: result.error };
    }
  }

  function onSuccess() {
    toast.success(t("success"));
    router.refresh();
  }

  function onError(_action: InvitationAction, _error: unknown) {
    toast.error(t("error"));
  }

  return (
    <InvitationActionsModalContextProviderBase
      onAction={onAction}
      onSuccess={onSuccess}
      onError={onError}
    >
      {children}
    </InvitationActionsModalContextProviderBase>
  );
}

export function useInvitationActionsModalContext() {
  return useInvitationActionsModalContextBase();
}
