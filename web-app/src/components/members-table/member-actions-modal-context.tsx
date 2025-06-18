"use client";

import { useTranslations } from "next-intl";
import { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import { revalidateOrganizationsPath } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { MemberRole, MemberWithUser } from "@/lib/db";

export enum MemberAction {
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

  async function onAction(member: MemberWithUser, action: MemberAction) {
    switch (action) {
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
    await revalidateOrganizationsPath();
    toast.success(
      action === MemberAction.REMOVE
        ? t("Successes.removeSuccess")
        : t("Successes.changeRoleSuccess"),
    );
  }

  function onError(action: MemberAction, error: unknown) {
    console.error(`Failed to "${action}" member`, error);
    toast.error(
      action === MemberAction.REMOVE
        ? t("Errors.removeError")
        : t("Errors.changeRoleError"),
    );
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
