"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { useIsMobile } from "@/hooks/use-mobile";

const CHAT_RAIL_COOKIE_NAME = "chat_sidebar_state";
const CHAT_RAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export interface AppChatRailContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  selectedConversationId: string | null;
  setSelectedConversationId: (conversationId: string | null) => void;
  isNewChat: boolean;
  closeRail: () => void;
  openConversation: (conversationId: string) => void;
  openLatestChat: () => void;
  openNewChat: () => void;
}

const AppChatRailContext = createContext<AppChatRailContextValue | null>(null);

interface AppChatRailProviderProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function AppChatRailProvider({
  children,
  defaultOpen = false,
}: AppChatRailProviderProps) {
  const isMobile = useIsMobile();
  const [open, setOpenState] = useState(defaultOpen);
  const [openMobile, setOpenMobile] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [isNewChat, setIsNewChat] = useState(false);

  const setOpen = useCallback((nextOpen: boolean) => {
    setOpenState(nextOpen);
    document.cookie = `${CHAT_RAIL_COOKIE_NAME}=${nextOpen}; path=/; max-age=${CHAT_RAIL_COOKIE_MAX_AGE}`;
  }, []);

  const closeRail = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
      return;
    }

    setOpen(false);
  }, [isMobile, setOpen]);

  const openConversation = useCallback(
    (conversationId: string) => {
      setSelectedConversationId(conversationId);
      setIsNewChat(false);

      if (isMobile) {
        setOpenMobile(true);
        return;
      }

      setOpen(true);
    },
    [isMobile, setOpen],
  );

  const openLatestChat = useCallback(() => {
    setSelectedConversationId(null);
    setIsNewChat(false);

    if (isMobile) {
      setOpenMobile(true);
      return;
    }

    setOpen(true);
  }, [isMobile, setOpen]);

  const openNewChat = useCallback(() => {
    setSelectedConversationId(null);
    setIsNewChat(true);

    if (isMobile) {
      setOpenMobile(true);
      return;
    }

    setOpen(true);
  }, [isMobile, setOpen]);

  const contextValue = useMemo<AppChatRailContextValue>(
    () => ({
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      selectedConversationId,
      setSelectedConversationId,
      isNewChat,
      closeRail,
      openConversation,
      openLatestChat,
      openNewChat,
    }),
    [
      closeRail,
      isMobile,
      isNewChat,
      open,
      openConversation,
      openLatestChat,
      openMobile,
      openNewChat,
      selectedConversationId,
      setOpen,
    ],
  );

  return (
    <AppChatRailContext.Provider value={contextValue}>
      {children}
    </AppChatRailContext.Provider>
  );
}

export function useAppChatRail(): AppChatRailContextValue {
  const context = useContext(AppChatRailContext);

  if (!context) {
    throw new Error(
      "useAppChatRail must be used within an AppChatRailProvider",
    );
  }

  return context;
}
