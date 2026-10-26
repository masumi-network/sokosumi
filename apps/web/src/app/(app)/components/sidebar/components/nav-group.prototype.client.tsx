"use client";

/**
 * PROTOTYPE, throwaway: a foldable nav group for sidebar variants b and c.
 * It wears the chat sections' own heading, so Records and Marketing fold the
 * way Pinned and Channels do. State is in memory only.
 */

import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useState,
} from "react";
import {
  ChatSidebarSectionContent,
  ChatSidebarSectionHeader,
} from "@/components/chat/chat-sidebar-section-header";
import { Collapsible } from "@/components/ui/collapsible";
import { SidebarMenu } from "@/components/ui/sidebar";

export function NavPrototypeGroup({
  title,
  railIcon,
  defaultOpen,
  children,
}: {
  title: string;
  railIcon: ComponentType<SVGProps<SVGSVGElement>>;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ChatSidebarSectionHeader isOpen={open} railIcon={railIcon}>
        {title}
      </ChatSidebarSectionHeader>
      <ChatSidebarSectionContent>
        <SidebarMenu className="gap-0">{children}</SidebarMenu>
      </ChatSidebarSectionContent>
    </Collapsible>
  );
}
