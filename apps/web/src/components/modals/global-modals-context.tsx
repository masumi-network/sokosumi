"use client";

import { createContext, useContext, useState } from "react";

import AuthenticationModal from "./authentication-modal";
import { CalendarClientUpgradeModal } from "./calendar-client-upgrade-modal";
import LogoutModal, { type LogoutModalUser } from "./logout-modal";

interface GlobalModalsContextType {
  showLogoutModal: (user: LogoutModalUser) => void;
  hideLogoutModal: () => void;
  showAuthenticationModal: () => void;
  hideAuthenticationModal: () => void;
  showCalendarClientUpgradeModal: () => void;
}

const GlobalModalsContext = createContext<GlobalModalsContextType>({
  showLogoutModal: () => {},
  hideLogoutModal: () => {},
  showAuthenticationModal: () => {},
  hideAuthenticationModal: () => {},
  showCalendarClientUpgradeModal: () => {},
});

export function GlobalModalsContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [logoutUser, setLogoutUser] = useState<LogoutModalUser | null>(null);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [authenticationModalOpen, setAuthenticationModalOpen] = useState(false);
  const [calendarClientUpgradeModalOpen, setCalendarClientUpgradeModalOpen] =
    useState(false);

  const showLogoutModal = (user: LogoutModalUser) => {
    setLogoutUser(user);
    setLogoutModalOpen(true);
  };

  const hideLogoutModal = () => {
    setLogoutModalOpen(false);
  };

  const showAuthenticationModal = () => {
    setAuthenticationModalOpen(true);
  };

  const hideAuthenticationModal = () => {
    setAuthenticationModalOpen(false);
  };

  const showCalendarClientUpgradeModal = () => {
    setCalendarClientUpgradeModalOpen(true);
  };

  const value: GlobalModalsContextType = {
    showLogoutModal,
    hideLogoutModal,
    showAuthenticationModal,
    hideAuthenticationModal,
    showCalendarClientUpgradeModal,
  };

  return (
    <GlobalModalsContext.Provider value={value}>
      <LogoutModal
        open={logoutModalOpen}
        onOpenChange={setLogoutModalOpen}
        user={logoutUser}
      />
      <AuthenticationModal
        open={authenticationModalOpen}
        onOpenChange={setAuthenticationModalOpen}
      />
      <CalendarClientUpgradeModal open={calendarClientUpgradeModalOpen} />
      {children}
    </GlobalModalsContext.Provider>
  );
}

export function useGlobalModalsContext() {
  const context = useContext(GlobalModalsContext);

  if (!context) {
    throw new Error(
      "useGlobalModalsContext must be used within a GlobalModalsContextProvider",
    );
  }

  return context;
}
