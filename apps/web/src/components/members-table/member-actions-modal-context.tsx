"use client";

import { MemberRole, type MemberWithUser } from "@sokosumi/database";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { createModalContext } from "@/components/common/modal-context";
import type {
  BetterAuthClientError,
  BetterAuthClientResult,
} from "@/lib/actions";
import {
  assignOrganizationSeat,
  unassignOrganizationSeat,
} from "@/lib/actions/organization/seat-action";
import { authClient } from "@/lib/auth/auth.client";

export enum MemberAction {
  ASSIGN_SEAT = "ASSIGN_SEAT",
  CHANGE_TO_OWNER = "CHANGE_TO_OWNER",
  CHANGE_TO_ADMIN = "CHANGE_TO_ADMIN",
  CHANGE_TO_MEMBER = "CHANGE_TO_MEMBER",
  REMOVE = "REMOVE",
  UNASSIGN_SEAT = "UNASSIGN_SEAT",
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
      case MemberAction.ASSIGN_SEAT: {
        const result = await assignOrganizationSeat({
          memberId: member.id,
          organizationId: member.organizationId,
        });
        if (!result.ok) {
          return {
            data: null,
            error: {
              message: result.error.message ?? t("Error.assignSeat"),
              status: 400,
              statusText: "Bad Request",
            },
          };
        }
        return { data: result.data, error: null };
      }
      case MemberAction.UNASSIGN_SEAT: {
        const result = await unassignOrganizationSeat({
          memberId: member.id,
          organizationId: member.organizationId,
        });
        if (!result.ok) {
          return {
            data: null,
            error: {
              message: result.error.message ?? t("Error.unassignSeat"),
              status: 400,
              statusText: "Bad Request",
            },
          };
        }
        return { data: result.data, error: null };
      }
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
    if (action === MemberAction.REMOVE) {
      toast.success(t("Success.remove"));
      return;
    }
    if (action === MemberAction.ASSIGN_SEAT) {
      toast.success(t("Success.assignSeat"));
      return;
    }
    if (action === MemberAction.UNASSIGN_SEAT) {
      toast.success(t("Success.unassignSeat"));
      return;
    }
    toast.success(t("Success.changeRole"));
  }

  function onError(action: MemberAction, error: BetterAuthClientError) {
    console.error(`Failed to "${action}" member`, error);

    const errorMessage =
      error.message ??
      (action === MemberAction.REMOVE
        ? t("Error.remove")
        : action === MemberAction.ASSIGN_SEAT
          ? t("Error.assignSeat")
          : action === MemberAction.UNASSIGN_SEAT
            ? t("Error.unassignSeat")
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
