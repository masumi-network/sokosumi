import DefaultErrorBoundary from "@/components/default-error-boundary";

import { ChatErrorFallback } from "./components/chat-error-fallback";

/**
 * When the virtual keyboard opens on mobile, the layout viewport resizes so
 * the room composer stays above the keyboard.
 */
export const viewport = {
  interactiveWidget: "resizes-content" as const,
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DefaultErrorBoundary fallback={<ChatErrorFallback />}>
      {children}
    </DefaultErrorBoundary>
  );
}
