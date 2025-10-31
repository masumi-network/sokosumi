"use client";

import { MemberRole, MemberWithUser } from "@sokosumi/database";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import { BetterAuthClientError, BetterAuthClientResult } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";

export enum MemberAction {
  CHANGE_TO_OWNER = "CHANGE_TO_OWNER",
  CHANGE_TO_ADMIN = "CHANGE_TO_ADMIN",
  CHANGE_TO_MEMBER = "CHANGE_TO_MEMBER",
  REMOVE = "REMOVE",
}

const {
  Provider: MemberActionsModalContextProviderBase,
  useModalContext: useMemberActionsModalContextBase,
} = createModalContext<MemberWithUser, MemberAction>();

export function MemberActionsModalContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("Components.MembersTable.MemberActions.Modal");
  const router = useRouter();

  async function onAction(
    member: MemberWithUser,
    action: MemberAction,
  ): Promise<BetterAuthClientResult<unknown>> {
    switch (action) {
      case MemberAction.CHANGE_TO_OWNER:
        return await authClient.organization.updateMemberRole({
          organizationId: member.organizationId,
          memberId: member.id,
          role: MemberRole.OWNER,
        });
      case MemberAction.CHANGE_TO_ADMIN:
        return await authClient.organization.updateMemberRole({
          organizationId: member.organizationId,
          memberId: member.id,
          role: MemberRole.ADMIN,
        });
      case MemberAction.CHANGE_TO_MEMBER:
        return await authClient.organization.updateMemberRole({
          organizationId: member.organizationId,
          memberId: member.id,
          role: MemberRole.MEMBER,
        });
      case MemberAction.REMOVE:
        return await authClient.organization.removeMember({
          organizationId: member.organizationId,
          memberIdOrEmail: member.id,
        });
    }
  }

  async function onSuccess(action: MemberAction) {
    router.refresh();
    toast.success(
      action === MemberAction.REMOVE
        ? t("Success.remove")
        : t("Success.changeRole"),
    );
  }

  function onError(action: MemberAction, error: BetterAuthClientError) {
    console.error(`Failed to "${action}" member`, error);

    const errorMessage =
      error.message ??
      (action === MemberAction.REMOVE
        ? t("Error.remove")
        : t("Error.changeRole"));
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
    <MemberActionsModalContextProviderBase
      onAction={onAction}
      onSuccess={onSuccess}
      onError={onError}
    >
      {children}
    </MemberActionsModalContextProviderBase>
  );
}

export function useMemberActionsModalContext() {
  return useMemberActionsModalContextBase();
}
