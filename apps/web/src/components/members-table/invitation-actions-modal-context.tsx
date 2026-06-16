"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import type {
  BetterAuthClientError,
  BetterAuthClientResult,
} from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import type { PendingInvitation } from "@/lib/types/core-dto";

export enum InvitationAction {
  CANCEL = "CANCEL",
}

const {
  Provider: InvitationActionsModalContextProviderBase,
  useModalContext: useInvitationActionsModalContextBase,
} = createModalContext<PendingInvitation, InvitationAction>();

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
    invitation: PendingInvitation,
    action: InvitationAction,
  ): Promise<BetterAuthClientResult<unknown>> {
    switch (action) {
      case InvitationAction.CANCEL:
        return await authClient.organization.cancelInvitation({
          invitationId: invitation.id,
        });
    }
  }

  function onSuccess() {
    toast.success(t("success"));
    router.refresh();
  }

  function onError(_action: InvitationAction, error: BetterAuthClientError) {
    const errorMessage = error.message ?? t("error");
    if (error.status === 401) {
      toast.error(errorMessage, {
        action: {
          label: t("Errors.unauthorizedAction"),
          onClick: () => {
            router.push(`/login`);
          },
        },
      });
    } else {
      toast.error(errorMessage);
    }
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
