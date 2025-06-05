"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";

import {
  changeMemberRole,
  kickMember,
  OrganizationActionErrorCode,
} from "@/lib/actions";
import { MemberWithUser } from "@/lib/db";
import { Role } from "@/prisma/generated/client";

export enum MemberAction {
  CHANGE_TO_ADMIN = "CHANGE_TO_ADMIN",
  CHANGE_TO_MEMBER = "CHANGE_TO_MEMBER",
  KICK = "KICK",
}

interface MemberActionsModalContextType {
  // modal
  open: boolean;
  setOpen: (open: boolean) => void;

  // loading
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // selected member and action
  selectedMember: MemberWithUser | null;
  selectedAction: MemberAction | null;

  // functions
  openActionModal: (member: MemberWithUser, action: MemberAction) => void;
  closeActionModal: () => void;
  startAction: () => Promise<void>;
}

const initialState: MemberActionsModalContextType = {
  open: false,
  setOpen: () => {},
  loading: false,
  setLoading: () => {},
  selectedMember: null,
  selectedAction: null,
  openActionModal: () => {},
  closeActionModal: () => {},
  startAction: async () => {},
};

export const MemberActionsModalContext =
  createContext<MemberActionsModalContextType>(initialState);

export function MemberActionsModalContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("Components.MembersTable.Actions.Modal");

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [selectedMember, setSelectedMember] = useState<MemberWithUser | null>(
    null,
  );
  const [selectedAction, setSelectedAction] = useState<MemberAction | null>(
    null,
  );

  const openActionModal = (member: MemberWithUser, action: MemberAction) => {
    if (open) {
      return;
    }

    setSelectedMember(member);
    setSelectedAction(action);
    setOpen(true);
  };

  const closeActionModal = () => {
    if (loading) {
      return;
    }

    setSelectedMember(null);
    setSelectedAction(null);
    setOpen(false);
  };

  const startAction = async () => {
    if (!selectedMember || !selectedAction) {
      return;
    }

    let result;
    setLoading(true);

    if (selectedAction === MemberAction.CHANGE_TO_ADMIN) {
      result = await changeMemberRole(
        selectedMember.organizationId,
        selectedMember.id,
        Role.ADMIN,
      );
    } else if (selectedAction === MemberAction.CHANGE_TO_MEMBER) {
      result = await changeMemberRole(
        selectedMember.organizationId,
        selectedMember.id,
        Role.MEMBER,
      );
    } else {
      result = await kickMember(
        selectedMember.organizationId,
        selectedMember.id,
      );
    }

    if (!result.success) {
      switch (result.error.code) {
        case OrganizationActionErrorCode.NOT_AUTHENTICATED:
          toast.error(t("Errors.notAuthenticated"));
          break;
        case OrganizationActionErrorCode.UNAUTHORIZED:
          toast.error(t("Errors.unauthorized"));
          break;
        case OrganizationActionErrorCode.MEMBER_NOT_FOUND:
          toast.error(t("Errors.memberNotFound"));
          break;
        case OrganizationActionErrorCode.MEMBER_NOT_IN_ORGANIZATION:
          toast.error(t("Errors.memberNotInOrganization"));
          break;
        case OrganizationActionErrorCode.CHANGE_MY_ROLE_NOT_ALLOWED:
          toast.error(t("Errors.changeMyRoleNotAllowed"));
          break;
        case OrganizationActionErrorCode.KICK_MYSELF_NOT_ALLOWED:
          toast.error(t("Errors.kickMyselfNotAllowed"));
          break;
        default:
          toast.error(
            selectedAction === MemberAction.KICK
              ? t("Errors.kickError")
              : t("Errors.changeRoleError"),
          );
          break;
      }
    } else {
      toast.success(
        selectedAction === MemberAction.KICK
          ? t("Successes.kickSuccess")
          : t("Successes.changeRoleSuccess"),
      );
      setOpen(false);
    }
    setLoading(false);
  };

  const value: MemberActionsModalContextType = {
    open,
    setOpen,
    loading,
    setLoading,
    selectedMember,
    selectedAction,
    openActionModal,
    closeActionModal,
    startAction,
  };

  return (
    <MemberActionsModalContext.Provider value={value}>
      {children}
    </MemberActionsModalContext.Provider>
  );
}

export function useMemberActionsModalContext() {
  const context = useContext(MemberActionsModalContext);
  if (!context) {
    throw new Error(
      "useMemberActionsModal must be used within a MemberActionsModalProvider",
    );
  }
  return context;
}
