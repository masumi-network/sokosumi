"use client";

import { createContext, useCallback, useContext, useState } from "react";

export interface ChatSecondarySidebarContextValue {
  showSecondarySidebar: boolean;
  setShowSecondarySidebar: (show: boolean) => void;
}

const ChatSecondarySidebarContext =
  createContext<ChatSecondarySidebarContextValue | null>(null);

export function ChatSecondarySidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showSecondarySidebar, setShowSecondarySidebar] = useState(false);
  const setShow = useCallback((show: boolean) => {
    setShowSecondarySidebar(show);
  }, []);

  return (
    <ChatSecondarySidebarContext.Provider
      value={{
        showSecondarySidebar,
        setShowSecondarySidebar: setShow,
      }}
    >
      {children}
    </ChatSecondarySidebarContext.Provider>
  );
}

export function useChatSecondarySidebar(): ChatSecondarySidebarContextValue {
  const context = useContext(ChatSecondarySidebarContext);
  if (!context) {
    throw new Error(
      "useChatSecondarySidebar must be used within a ChatSecondarySidebarProvider",
    );
  }
  return context;
}
