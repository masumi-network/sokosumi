"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { createContext, type ReactNode, use } from "react";
import type { PartitionedSidebarRooms } from "./partition-rooms-for-sidebar";
import {
  resolveSectionAttention,
  resolveUnreadThreadsAttention,
  type SectionAttention,
} from "./room-attention";

export type SidebarChatEntryId =
  | "catch-up"
  | "pinned"
  | "channels"
  | "external"
  | "archived"
  | "direct-messages";

type ChatEntries = Readonly<Record<SidebarChatEntryId, ReactNode>>;

interface ChatControls {
  actions: ReactNode;
  attentionFor?: (entryIds: readonly string[]) => SectionAttention;
  onOpenChange?: (open: boolean) => void;
}

/** Navigation can render before the scoped, live room collection is ready. */
export const SidebarChatContext = createContext<{
  entries: ChatEntries;
  unreadCategories?: Partial<ChatEntries> | undefined;
  controls: ChatControls;
}>({
  entries: {
    "catch-up": null,
    pinned: null,
    channels: null,
    external: null,
    archived: null,
    "direct-messages": null,
  },
  controls: { actions: null },
});

export function useSidebarChatEntries(hasCatchUp = true) {
  const { entries, unreadCategories } = use(SidebarChatContext);
  return hasCatchUp || !unreadCategories
    ? entries
    : { ...entries, ...unreadCategories };
}

export function useSidebarChatControls() {
  return use(SidebarChatContext).controls;
}

export function sidebarChatAttention(
  groups: PartitionedSidebarRooms,
  rooms: readonly ChatRoom[],
  elsewhereAndInbox: readonly ChatRoom[],
  hasPendingInvitation: boolean,
) {
  const { threadCount, mentionCount } = resolveUnreadThreadsAttention(rooms);
  const elsewhere = resolveSectionAttention(elsewhereAndInbox);
  const needsYou = rooms.some(
    (room) => room.mutedAt == null && (room.unreadNeedsYouCount ?? 0) > 0,
  );
  const catchUp =
    needsYou || mentionCount > 0 || elsewhere === "mention"
      ? "mention"
      : threadCount > 0
        ? "unread"
        : elsewhere;
  const byId = new Map<string, SectionAttention>([
    ["catch-up", catchUp],
    ["pinned", resolveSectionAttention(groups.pinned)],
    ["channels", resolveSectionAttention(groups.namedChannels)],
    [
      "external",
      resolveSectionAttention(groups.externalJoined, { hasPendingInvitation }),
    ],
    ["direct-messages", resolveSectionAttention(groups.directMessages)],
  ]);
  return (ids: readonly string[]): SectionAttention => {
    let result: SectionAttention = null;
    for (const id of ids) {
      const attention = byId.get(id);
      if (attention === "mention") return "mention";
      if (attention === "unread") result = "unread";
    }
    return result;
  };
}
