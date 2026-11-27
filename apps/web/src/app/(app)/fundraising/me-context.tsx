"use client";
import { createContext, type ReactNode, useContext } from "react";
import { useSession } from "@/lib/auth/auth.client";

const MeContext = createContext<string | null>(null);

/** The signed-in user's id from the server, so the first paint already knows who "you" is. */
export function MeProvider({
  meId,
  children,
}: {
  meId: string;
  children: ReactNode;
}) {
  return <MeContext.Provider value={meId}>{children}</MeContext.Provider>;
}

/** The viewer's user id: the server's when a page gave it, else the browser session's once it loads. */
export function useMeId(): string | null {
  const fromServer = useContext(MeContext);
  const session = useSession().data?.user.id ?? null;
  return fromServer ?? session;
}
