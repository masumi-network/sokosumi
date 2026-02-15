"use client";

import { createContext, useContext } from "react";

import { useConversations } from "@/app/chat/hooks/use-conversations";
import type { ActionError } from "@/lib/actions";
import {
  type Conversation,
  type ConversationWithItems,
} from "@/lib/actions/conversation/core-api-actions";

export interface ConversationsContextValue {
  conversations: Conversation[];
  selectedConversation: ConversationWithItems | null;
  isLoading: boolean;
  error: ActionError | null;
  createNewConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<Conversation | null>;
  selectConversation: (id: string) => Promise<ConversationWithItems | null>;
  updateSelectedConversation: (
    metadata?: Record<string, unknown>,
    title?: string,
  ) => Promise<void>;
  deleteSelectedConversation: () => Promise<void>;
  deleteConversationById: (id: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

const ConversationsContext = createContext<ConversationsContextValue | null>(
  null,
);

export function ConversationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useConversations();
  return (
    <ConversationsContext.Provider value={value}>
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversationsContext(): ConversationsContextValue {
  const context = useContext(ConversationsContext);
  if (!context) {
    throw new Error(
      "useConversationsContext must be used within a ConversationsProvider",
    );
  }
  return context;
}
