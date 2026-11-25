"use client";

import type { ReactNode } from "react";
import { useIsMobileMedia } from "@/hooks/effects/use-mobile";

export function DesktopChatsLanding({ children }: { children: ReactNode }) {
  return useIsMobileMedia() === false ? children : null;
}
