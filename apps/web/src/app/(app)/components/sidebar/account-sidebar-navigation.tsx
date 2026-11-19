"use client";

import { MessagesSquare, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { ChatSidebarSectionHeader } from "@/components/chat/chat-sidebar-section-header";
import type { SectionAttention } from "@/components/chat/room-attention";
import {
  type SidebarChatEntryId,
  useSidebarChatControls,
  useSidebarChatEntries,
} from "@/components/chat/sidebar-chat-entries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { SheetClose } from "@/components/ui/sheet";
import { SidebarMenu } from "@/components/ui/sidebar";
import { SIDEBAR_PROJECT_SCOPED_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionContent } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import { isPathActive } from "@/lib/utils/is-path-active";
import { useSidebarDestinations } from "./components/menu-items";
import { SidebarNewIndicator } from "./components/sidebar-feature-label";
import {
  resolveSidebarLayout,
  type SidebarFeature,
  type SidebarLayoutSection,
} from "./layout/sidebar-layout";
import { SidebarLayoutEditor } from "./layout/sidebar-layout-editor";
import { useAccountSidebarLayout } from "./use-account-sidebar-layout";

const CHAT_LABELS = {
  "catch-up": "Signals.catchUp",
  pinned: "pinned",
  channels: "title",
  external: "External.title",
  archived: "archivedChannels",
  "direct-messages": "directMessages",
} as const satisfies Record<SidebarChatEntryId, string>;

function isChatEntry(id: string): id is SidebarChatEntryId {
  return Object.hasOwn(CHAT_LABELS, id);
}

interface NavigationProps {
  userId: string;
  newsletterEnabled: boolean;
  hasOrganization: boolean;
  waitingForRooms?: boolean;
}

export function AccountSidebarNavigation({
  userId,
  newsletterEnabled,
  hasOrganization,
  waitingForRooms = false,
}: NavigationProps) {
  const t = useTranslations("App.Sidebar.Layout");
  const tMenu = useTranslations("App.Sidebar.Content.MenuItems");
  const tChat = useTranslations("App.Channels");
  const { destinations, renderItem: renderDestination } =
    useSidebarDestinations(newsletterEnabled);
  const chatControls = useSidebarChatControls();
  const account = useAccountSidebarLayout(userId);
  const { editing, currentLayout } = account;
  const hasCatchUp =
    currentLayout?.sections.some(({ items }) => items.includes("catch-up")) ??
    true;
  const chatEntries = useSidebarChatEntries(hasCatchUp);
  const pathname = usePathname();
  const openNewItem = destinations.find(
    ({ key, href, available }) =>
      available && account.isUnseen(key) && isPathActive(pathname, href),
  )?.key;
  const recordVisit = useEffectEvent(account.markSeen);
  useEffect(() => {
    if (openNewItem) recordVisit(openNewItem);
  }, [openNewItem]);

  const features: SidebarFeature[] = destinations.map((item) => ({
    id: item.key,
    label: item.label,
    defaultSection: item.group,
    available: item.available,
  }));
  for (const id of Object.keys(CHAT_LABELS)) {
    if (!isChatEntry(id)) continue;
    features.push({
      id,
      label: tChat(CHAT_LABELS[id]),
      defaultSection: "chats",
      available: hasOrganization || (id !== "channels" && id !== "archived"),
      hasContent: waitingForRooms || chatEntries[id] != null,
    });
  }
  const visibleIds = new Set(
    features
      .filter((feature) => feature.available && feature.hasContent !== false)
      .map(({ id }) => id),
  );
  const layout = resolveSidebarLayout(currentLayout, features);
  const sections = layout.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((id) => visibleIds.has(id)),
    }))
    .filter((section) => section.items.length > 0);
  const controlsSection =
    sections.find(({ items }) => items.includes("catch-up")) ??
    sections.find(({ items }) => items.some(isChatEntry));

  // Unreads can empty the last visible chat section. Its switch and shortcut
  // must still be reachable so the reader can return to all rooms.
  const showControlsInFooter =
    !controlsSection &&
    layout.sections.some((section) => section.items.some(isChatEntry));

  function sectionLabel(section: SidebarLayoutSection) {
    if (section.name) return section.name;
    switch (section.id) {
      case "work":
      case "records":
      case "marketing":
        return tMenu(`groups.${section.id}`);
      case "chats":
        return tChat("chats");
      default:
        return section.id;
    }
  }

  function renderEntry(id: string) {
    const marker = account.isUnseen(id) ? (
      <SidebarNewIndicator withIcon />
    ) : null;
    if (isChatEntry(id)) {
      if (waitingForRooms) {
        return (
          <li key={id} className="text-muted-foreground px-2 py-1 text-xs">
            {tChat(CHAT_LABELS[id])}
          </li>
        );
      }
      const node = chatEntries[id];
      if (!node) return null;
      return (
        <li
          key={id}
          onClickCapture={
            marker && !editing ? () => account.markSeen(id) : undefined
          }
        >
          {marker}
          {node}
        </li>
      );
    }
    const destination = destinations.find(
      (item) => item.key === id && item.available,
    );
    return destination
      ? renderDestination(
          destination,
          marker,
          marker && !editing ? () => account.markSeen(id) : undefined,
        )
      : null;
  }

  if (account.preferences.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label={t("edit")}
        className="space-y-2 px-4 py-2"
      >
        {["w-20", "w-28", "w-16"].map((width) => (
          <div
            key={width}
            aria-hidden
            className={cn(
              "bg-muted h-4 rounded-sm motion-safe:animate-pulse",
              width,
            )}
          />
        ))}
      </div>
    );
  }

  if (editing) {
    return (
      <SidebarLayoutEditor
        layout={layout}
        features={features}
        sectionLabel={sectionLabel}
        renderItem={(id) => (
          <SidebarMenu className="gap-0">{renderEntry(id)}</SidebarMenu>
        )}
        onChange={account.setDraft}
        onSave={account.save}
        onCancel={account.cancel}
        saving={account.saving}
      />
    );
  }

  return (
    <>
      {sections.map((section) => (
        <SidebarNavigationSection
          key={section.id}
          title={sectionLabel(section)}
          projectScoped={section.items.every((id) => !isChatEntry(id))}
          actions={
            section.id === controlsSection?.id
              ? chatControls.actions
              : undefined
          }
          attention={chatControls.attentionFor?.(section.items)}
          onToggle={
            section.items.includes("pinned")
              ? chatControls.onOpenChange
              : undefined
          }
        >
          {section.items.map(renderEntry)}
        </SidebarNavigationSection>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-2">
        {showControlsInFooter && chatControls.actions}
        <SheetClose asChild>
          <Link
            href="/chat?view=all"
            className={buttonVariants({ size: "sm", variant: "ghost" })}
          >
            <MessagesSquare aria-hidden />
            {t("allChats")}
          </Link>
        </SheetClose>
        <Button
          size="sm"
          variant="ghost"
          disabled={waitingForRooms || !account.preferences.data}
          onClick={account.edit}
        >
          <Settings2 aria-hidden />
          {t("edit")}
        </Button>
        {account.preferences.isError && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void account.preferences.refetch()}
          >
            {t("loadFailed")}
          </Button>
        )}
      </div>
    </>
  );
}

function SidebarNavigationSection({
  title,
  projectScoped,
  actions,
  attention,
  onToggle,
  children,
}: {
  title: string;
  projectScoped: boolean;
  actions?: ReactNode;
  attention?: SectionAttention | undefined;
  onToggle?: ((open: boolean) => void) | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        onToggle?.(value);
      }}
      className={cn("px-2", projectScoped && SIDEBAR_PROJECT_SCOPED_CLASS)}
    >
      <ChatSidebarSectionHeader
        isOpen={open}
        inlineAction={actions}
        closedAttention={attention ?? null}
      >
        {title}
      </ChatSidebarSectionHeader>
      <SidebarSectionContent className="overflow-visible">
        <SidebarMenu className="gap-0">{children}</SidebarMenu>
      </SidebarSectionContent>
    </Collapsible>
  );
}
