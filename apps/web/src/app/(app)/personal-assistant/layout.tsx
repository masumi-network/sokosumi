import type { ReactNode } from "react";

import { ClientMessageBoundary } from "@/i18n/client-message-boundary";
import { HERMES_MESSAGE_PATHS } from "@/i18n/message-namespaces";

import FullscreenEffect from "./components/fullscreen-effect";

export const instant = false;

interface HermesLayoutProps {
  children: ReactNode;
}

export default function HermesLayout({ children }: HermesLayoutProps) {
  // We DON'T use `data-agent-fullbleed` here even though it nicely zeros
  // main's p-4 padding. That helper also sets `overflow: visible` on
  // main + every ancestor up to the app shell, which delegates scrolling
  // to the document body. Setup screens (OnboardingProgress / Provisioning)
  // are slightly taller than viewport on some sizes and end up with a
  // useless body-level scroll into empty space.
  //
  // Padding-zero is handled by our own CSS rule keyed off the body's
  // `data-hermes-fullscreen` attribute (see globals.css). That rule keeps
  // main's `overflow-y-auto` so any scroll is contained inside main —
  // long pages (EmptyState) scroll normally; short pages (setup loaders)
  // don't get a phantom body scroll.
  return (
    <ClientMessageBoundary paths={HERMES_MESSAGE_PATHS}>
      <FullscreenEffect />
      {children}
    </ClientMessageBoundary>
  );
}
