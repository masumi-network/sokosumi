"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { SIDEBAR_ROW_CLASS } from "@/components/ui/sidebar-classes";
import { SidebarSectionTrigger } from "@/components/ui/sidebar-section";
import { cn } from "@/lib/utils";
import type { SectionAttention } from "./room-attention";

/**
 * Collapsible section heading for the chat sidebar (Channels, External,
 * Archived, Direct Messages).
 *
 * The trailing padding steps with how many action controls sit in the
 * absolutely-positioned trailing slot, so a long section title truncates
 * before it runs under them. Below `md` each control reaches 44px through a
 * pseudo-element, and the slot's gap keeps those two targets from overlapping.
 *
 * A closed section hides its rooms, and with them whatever they held for the
 * reader. `closedAttention` says so on the heading: the row's own bold on the
 * title, and the room row's unread/mention string in its accessible name. An
 * open section passes none, because its rooms speak for themselves.
 */
export function ChatSidebarSectionHeader({
  children,
  isOpen,
  closedAttention = null,
  createAction,
  secondaryAction,
}: {
  /** The section's title. */
  children: string;
  isOpen: boolean;
  closedAttention?: SectionAttention;
  createAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const tChannels = useTranslations("App.Channels");
  const trailingCount = (secondaryAction ? 1 : 0) + (createAction ? 1 : 0);
  const attention = isOpen ? null : closedAttention;
  const attentionLabel =
    attention === "mention"
      ? tChannels("RoomMentions.mentionsYou")
      : attention === "unread"
        ? tChannels("RoomUnread.unread")
        : null;

  return (
    <div className={cn(SIDEBAR_ROW_CLASS, "relative")}>
      <SidebarSectionTrigger
        title={children}
        screenReaderNote={attentionLabel}
        className={cn(
          attention && "text-foreground font-semibold",
          trailingCount === 1 && "pr-9",
          trailingCount >= 2 && "pr-20",
          trailingCount === 0 && "md:pr-0",
          trailingCount === 1 && "md:pr-8",
          trailingCount >= 2 && "md:pr-14",
        )}
      />
      {trailingCount > 0 ? (
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-3.5 md:gap-0">
          {secondaryAction}
          {createAction}
        </div>
      ) : null}
    </div>
  );
}
