"use client";

import { createContext, useContext, useState } from "react";

import { MemberWithUser } from "@/lib/db";

enum MemberAction {
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
};

export const MemberActionsModalContext =
  createContext<MemberActionsModalContextType>(initialState);

export function MemberActionsModalContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const value: MemberActionsModalContextType = {
    open,
    setOpen,
    loading,
    setLoading,
    selectedMember,
    selectedAction,
    openActionModal,
    closeActionModal,
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
