"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";

import { revalidateOrganizationsPath } from "@/lib/actions";
import { authClient } from "@/lib/auth/auth.client";
import { MemberRole, MemberWithUser } from "@/lib/db";

export enum MemberAction {
  CHANGE_TO_ADMIN = "CHANGE_TO_ADMIN",
  CHANGE_TO_MEMBER = "CHANGE_TO_MEMBER",
  REMOVE = "REMOVE",
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
      result = await authClient.organization.updateMemberRole({
        organizationId: selectedMember.organizationId,
        memberId: selectedMember.id,
        role: MemberRole.ADMIN,
      });
    } else if (selectedAction === MemberAction.CHANGE_TO_MEMBER) {
      result = await authClient.organization.updateMemberRole({
        organizationId: selectedMember.organizationId,
        memberId: selectedMember.id,
        role: MemberRole.MEMBER,
      });
    } else {
      result = await authClient.organization.removeMember({
        organizationId: selectedMember.organizationId,
        memberIdOrEmail: selectedMember.id,
      });
    }

    if (result.error) {
      console.error(`Failed to "${selectedAction}" member`, result.error);
      toast.error(
        selectedAction === MemberAction.REMOVE
          ? t("Errors.removeError")
          : t("Errors.changeRoleError"),
      );
    } else {
      await revalidateOrganizationsPath();
      toast.success(
        selectedAction === MemberAction.REMOVE
          ? t("Successes.removeSuccess")
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
