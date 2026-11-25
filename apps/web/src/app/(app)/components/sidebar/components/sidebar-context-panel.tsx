"use client";

import type { ReactNode } from "react";
import { useNavPathname } from "@/components/navigation-progress.client";
import { sidebarSection } from "./sidebar-sections";

/** Keep chat subscriptions and disclosure state mounted across sections. */
export function SidebarContextPanel({
  chats,
  children,
}: {
  chats: ReactNode;
  children: ReactNode;
}) {
  const showChats = sidebarSection(useNavPathname()) === "chats";

  return (
    <>
      <div hidden={showChats}>{children}</div>
      <div hidden={!showChats}>{chats}</div>
    </>
  );
}
