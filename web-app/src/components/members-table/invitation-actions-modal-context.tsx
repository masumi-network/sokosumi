"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";
import { Invitation } from "@/prisma/generated/client";

interface InvitationActionsModalContextType {
  // modal
  open: boolean;
  setOpen: (open: boolean) => void;

  // loading
  loading: boolean;
  setLoading: (loading: boolean) => void;

  // selected member and action
  selectedInvitation: Invitation | null;

  // functions
  openActionModal: (invitation: Invitation) => void;
  closeActionModal: () => void;
  startAction: () => Promise<void>;
}

const initialState: InvitationActionsModalContextType = {
  open: false,
  setOpen: () => {},
  loading: false,
  setLoading: () => {},
  selectedInvitation: null,
  openActionModal: () => {},
  closeActionModal: () => {},
  startAction: async () => {},
};

export const InvitationActionsModalContext =
  createContext<InvitationActionsModalContextType>(initialState);

export function InvitationActionsModalContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations(
    "Components.MembersTable.InvitationActions.CancelModal",
  );

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [selectedInvitation, setSelectedInvitation] =
    useState<Invitation | null>(null);

  const openActionModal = (invitation: Invitation) => {
    if (open) {
      return;
    }

    setSelectedInvitation(invitation);
    setOpen(true);
  };

  const closeActionModal = () => {
    if (loading) {
      return;
    }

    setSelectedInvitation(null);
    setOpen(false);
  };

  const startAction = async () => {
    if (!selectedInvitation) {
      return;
    }
    setLoading(true);
    await authClient.organization.cancelInvitation(
      {
        invitationId: selectedInvitation.id,
      },
      {
        onError: ({ error }) => {
          console.log("Failed to cancel invitation", error);
          toast.error(t("error"));
        },
        onSuccess: () => {
          toast.success(t("success"));
          router.refresh();
          setOpen(false);
        },
      },
    );
    setLoading(false);
  };

  const value: InvitationActionsModalContextType = {
    open,
    setOpen,
    loading,
    setLoading,
    selectedInvitation,
    openActionModal,
    closeActionModal,
    startAction,
  };

  return (
    <InvitationActionsModalContext.Provider value={value}>
      {children}
    </InvitationActionsModalContext.Provider>
  );
}

export function useInvitationActionsModalContext() {
  const context = useContext(InvitationActionsModalContext);
  if (!context) {
    throw new Error(
      "useInvitationActionsModal must be used within a InvitationActionsModalProvider",
    );
  }
  return context;
}
