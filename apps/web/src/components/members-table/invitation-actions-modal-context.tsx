"use client";

import type { PendingInvitation } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { createModalContext } from "@/components/common/modal-context";
import type {
  BetterAuthClientError,
  BetterAuthClientResult,
} from "@/lib/actions/errors/better-auth";
import { authClient } from "@/lib/auth/auth.client";

export enum InvitationAction {
  CANCEL = "CANCEL",
}

const {
  Provider: InvitationActionsModalContextProviderBase,
  useModalContext: useInvitationActionsModalContextBase,
} = createModalContext<PendingInvitation, InvitationAction>();

export function InvitationActionsModalContextProvider({
  children,
  onCancelling,
}: {
  children: ReactNode;
  /**
   * The invitation left (`true`) or came back to (`false`) the table. It
   * leaves when the cancel starts and comes back when the cancel fails.
   */
  onCancelling: (invitationId: string, cancelling: boolean) => void;
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
      case InvitationAction.CANCEL: {
        onCancelling(invitation.id, true);
        // A request that never reached Core is a failed cancel like any other.
        const result = await authClient.organization
          .cancelInvitation({ invitationId: invitation.id })
          .catch(
            (): BetterAuthClientResult<null> => ({
              data: null,
              error: { status: 0, statusText: "" },
            }),
          );
        if (result.error) onCancelling(invitation.id, false);
        return result;
      }
    }
  }

  function onSuccess() {
    toast.success(t("success"));
    router.refresh();
  }

  // The dialog is closed by now, so the toast names the invitation.
  function onError(
    _action: InvitationAction,
    error: BetterAuthClientError,
    invitation: PendingInvitation,
  ) {
    const errorMessage = t("error", { email: invitation.email });
    const description = error.message;
    if (error.status === 401) {
      toast.error(errorMessage, {
        description,
        action: {
          label: t("Errors.unauthorizedAction"),
          onClick: () => {
            router.push(`/signin`);
          },
        },
      });
    } else {
      toast.error(errorMessage, { description });
    }
  }

  return (
    <InvitationActionsModalContextProviderBase
      onAction={onAction}
      onSuccess={onSuccess}
      onError={onError}
      closeOnStart
    >
      {children}
    </InvitationActionsModalContextProviderBase>
  );
}

export function useInvitationActionsModalContext() {
  return useInvitationActionsModalContextBase();
}
