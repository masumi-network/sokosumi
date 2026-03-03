"use client";

import { createContext, useContext } from "react";

export const ChatRouteBaseContext = createContext<{ basePath: string }>({
  basePath: "/chat",
});

export function useChatRouteBase(): string {
  return useContext(ChatRouteBaseContext).basePath;
}
