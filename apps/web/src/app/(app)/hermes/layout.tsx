import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hermesBetaEnabled } from "@/lib/flags/hermes-beta";

import FullscreenEffect from "./components/fullscreen-effect";

interface HermesLayoutProps {
  children: ReactNode;
}

export default async function HermesLayout({ children }: HermesLayoutProps) {
  if (!(await hermesBetaEnabled())) {
    notFound();
  }

  // `data-agent-fullbleed` triggers the existing AppLayout CSS hook that
  // zeros main's 16px `p-4` padding (see globals.css). Without this, the
  // FlowBackground screens render with a visible 16px frame around them.
  // The chat (RunningState) doesn't show this because its rounded-lg
  // wrapper makes the frame look intentional, but the setup flow has
  // FlowBackground edge-to-edge and the padding reads as a white border.
  return (
    <div data-agent-fullbleed className="flex h-full w-full flex-1 flex-col">
      <FullscreenEffect />
      {children}
    </div>
  );
}
