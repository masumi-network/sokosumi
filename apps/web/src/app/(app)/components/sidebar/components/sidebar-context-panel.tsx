"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { CHAT_CHATS_LIST_PATH } from "@/app/chat/utils/chat-route-base";
import { useNavPathname } from "@/components/navigation-progress.client";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRowSlot,
  useSidebar,
} from "@/components/ui/sidebar";
import { SIDEBAR_ROW_LABEL_CLASS } from "@/components/ui/sidebar-classes";
import { type SidebarSection, sidebarSection } from "./sidebar-sections";

const PanelContext = createContext<{
  section: SidebarSection;
  selectSection: (section: SidebarSection) => void;
} | null>(null);

export function SidebarPanelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navPathname = useNavPathname();
  const [selection, setSelection] = useState<{
    pathname: string;
    section: SidebarSection | null;
  }>({ pathname, section: null });

  // A committed route change (including Back/Forward) starts from its own panel.
  if (selection.pathname !== pathname) {
    setSelection({ pathname, section: null });
  }

  const section =
    (selection.pathname === pathname ? selection.section : null) ??
    sidebarSection(navPathname) ??
    "work";
  const value = useMemo(
    () => ({
      section,
      selectSection: (nextSection: SidebarSection) =>
        setSelection({ pathname, section: nextSection }),
    }),
    [pathname, section],
  );

  return <PanelContext value={value}>{children}</PanelContext>;
}

export function useSidebarPanel() {
  const context = useContext(PanelContext);
  const pathname = useNavPathname();
  return (
    context ?? {
      section: sidebarSection(pathname) ?? "work",
      selectSection: undefined,
    }
  );
}

/** Keep chat subscriptions and disclosure state mounted across sections. */
export function SidebarContextPanel({
  chats,
  children,
}: {
  chats: ReactNode;
  children: ReactNode;
}) {
  const showChats = useSidebarPanel().section === "chats";

  return (
    <div id="app-sidebar-panel">
      <div hidden={showChats}>{children}</div>
      <div hidden={!showChats}>{chats}</div>
    </div>
  );
}

export function SidebarMobileChatsDestination() {
  return useSidebar().isMobile ? <MobileChatsLink /> : null;
}

function MobileChatsLink() {
  const nav = useTranslations("App.Channels.MobileNav");
  const { setOpenMobile } = useSidebar();
  const isActive = useNavPathname() === CHAT_CHATS_LIST_PATH;

  return (
    <SidebarGroup className="px-2 py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={isActive}>
            <Link
              href={CHAT_CHATS_LIST_PATH}
              aria-current={isActive ? "page" : undefined}
              onNavigate={() => setOpenMobile(false)}
            >
              <SidebarRowSlot aria-hidden>
                <MessageCircle aria-hidden />
              </SidebarRowSlot>
              <span className={SIDEBAR_ROW_LABEL_CLASS}>{nav("chats")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
