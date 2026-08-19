import type { ReactNode } from "react";

import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { SOKO_BOT_MESSAGE_PATHS } from "@/i18n/message-namespaces";

export const instant = false;

interface SokoBotLayoutProps {
  children: ReactNode;
}

/** Personal Assistant (Soko Bot) — open to every signed-in user. */
export default function SokoBotLayout({ children }: SokoBotLayoutProps) {
  return (
    <ClientMessageBoundary paths={SOKO_BOT_MESSAGE_PATHS}>
      {children}
    </ClientMessageBoundary>
  );
}
