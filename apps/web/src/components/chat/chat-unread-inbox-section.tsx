"use client";
import type { ChatRoom } from "@sokosumi/core-client";
import { CheckCheck } from "lucide-react";
import {
  AnimatePresence,
  type MotionProps,
  motion,
  type Transition,
} from "motion/react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { SidebarMenu, SidebarRowSlot } from "@/components/ui/sidebar";
import { SIDEBAR_ROW_CLASS } from "@/components/ui/sidebar-classes";
import { cn } from "@/lib/utils";
import {
  ChatRoomSidebarRow,
  type ChatRoomSidebarRowProps,
} from "./chat-room-sidebar-row";

/**
 * A room the All unreads filter lists with nothing unread: read during the
 * pass, or pinned. Dimmed.
 */
/**
 * One timing for everything the All unreads filter animates: motion's
 * presence, and the same curve and length for its CSS dim and fade.
 */
export const UNREAD_FILTER_TRANSITION: Transition = {
  duration: 0.2,
  ease: [0.2, 0, 0, 1],
};
export const UNREAD_FILTER_CSS_TIMING =
  "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0,0,1)]";

export const READ_INBOX_ROOM_ITEM_PROPS = {
  "data-read": "true",
  // Eases down when the reader moves on from a room they just read. Coming
  // back to full is instant: that is new activity, and it should be seen.
  className: `opacity-60 motion-safe:transition-opacity ${UNREAD_FILTER_CSS_TIMING}`,
};

/**
 * The caught-up row and its "Read just now" label, in and out. Height, so
 * what is below slides instead of jumping, and at the same timing as a room
 * arriving, so a room taking the caught-up row's place nets out to no move.
 */
const UNREAD_FILTER_PRESENCE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  style: { overflow: "hidden" },
} satisfies MotionProps;

/**
 * The caught-up message is a row of the list above it, not a section: it
 * cancels the 8px gap that sets sections apart (the `space-y-2` of the chat
 * area, which collapses with this margin). The margin moves with the height,
 * so a room taking its place brings the gap back as the message leaves.
 */
const UNREAD_CAUGHT_UP_PRESENCE = {
  initial: { ...UNREAD_FILTER_PRESENCE.initial, marginTop: 0 },
  animate: { ...UNREAD_FILTER_PRESENCE.animate, marginTop: -8 },
  exit: { ...UNREAD_FILTER_PRESENCE.exit, marginTop: 0 },
  style: UNREAD_FILTER_PRESENCE.style,
} satisfies MotionProps;

/**
 * A room arriving in or leaving the filter's list. No opacity: a read room's
 * dimming is a class on the same `<li>`, and a finished fade would pin it at
 * full. Clipped only while it moves, because the row's focus ring sits on
 * the edge of its box.
 */
const UNREAD_FILTER_ROW_PRESENCE = {
  initial: { height: 0, overflow: "hidden" },
  animate: { height: "auto", transitionEnd: { overflow: "visible" } },
  exit: { height: 0, overflow: "hidden" },
} satisfies MotionProps;

type RoomRowProps = (room: ChatRoom) => ChatRoomSidebarRowProps;

export function UnreadInboxSection({
  caughtUp,
  showsReadLabel,
  hasNeedsYou,
  needsYou,
  other,
  roomRowProps,
}: {
  caughtUp: boolean;
  showsReadLabel: boolean;
  hasNeedsYou: boolean;
  needsYou: readonly ChatRoom[];
  other: readonly ChatRoom[];
  roomRowProps: RoomRowProps;
}) {
  const t = useTranslations("App.Channels");
  // The app sidebar and the mobile `/chat` page each mount this list.
  const inboxReadLabelId = useId();
  const inboxNeedsYouLabelId = useId();
  return (
    // Present for the whole pass, empty or not, so a room arriving in an
    // empty list animates in: `initial={false}` only spares the rows
    // already here when the filter comes on. Hidden while it holds
    // nothing, so it adds no gap.
    <div className="[&:not(:has(li,[role=status]))]:hidden">
      <AnimatePresence initial={false}>
        {caughtUp ? (
          // A message, not a row: nothing here opens. The way back to
          // every room is the tinted Unreads chip above it. Row
          // sized, so a room arriving takes its place and nothing below
          // moves. Muted like a read row: the tinted circle and weight
          // are the unread signal, and this says there is none.
          <motion.div
            key="caught-up"
            role="status"
            data-slot="unread-caught-up"
            {...UNREAD_CAUGHT_UP_PRESENCE}
          >
            <div
              className={cn(SIDEBAR_ROW_CLASS, "text-muted-foreground text-sm")}
            >
              <SidebarRowSlot>
                <CheckCheck aria-hidden />
              </SidebarRowSlot>
              <span className="min-w-0 truncate">
                {t("UnreadNav.caughtUp")}
              </span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {showsReadLabel ? (
          // Everything left is read: say why it is still listed.
          <motion.div key="read-label" {...UNREAD_FILTER_PRESENCE}>
            <p
              id={inboxReadLabelId}
              className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium"
            >
              {t("UnreadNav.justRead")}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {hasNeedsYou ? (
        <>
          <p
            id={inboxNeedsYouLabelId}
            className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium"
          >
            {t("Signals.needsYouSection")}
          </p>
          <SidebarMenu
            data-slot="unread-inbox-needs-you"
            aria-labelledby={inboxNeedsYouLabelId}
            className="gap-0"
          >
            <AnimatePresence initial={false}>
              {needsYou.map((room) => (
                <ChatRoomSidebarRow
                  key={room.id}
                  {...roomRowProps(room)}
                  itemMotion={UNREAD_FILTER_ROW_PRESENCE}
                />
              ))}
            </AnimatePresence>
          </SidebarMenu>
        </>
      ) : null}
      <SidebarMenu
        data-slot="unread-inbox"
        aria-labelledby={showsReadLabel ? inboxReadLabelId : undefined}
        className="gap-0"
      >
        <AnimatePresence initial={false}>
          {other.map((room) => (
            <ChatRoomSidebarRow
              key={room.id}
              {...roomRowProps(room)}
              itemMotion={UNREAD_FILTER_ROW_PRESENCE}
            />
          ))}
        </AnimatePresence>
      </SidebarMenu>
    </div>
  );
}

export function UnreadInboxPinnedRooms({
  rooms,
  roomRowProps,
}: {
  rooms: readonly ChatRoom[];
  roomRowProps: RoomRowProps;
}) {
  const t = useTranslations("App.Channels");
  const inboxPinnedLabelId = useId();
  return (
    <div>
      <p
        id={inboxPinnedLabelId}
        className="text-muted-foreground px-2 pb-1 text-xs font-medium"
      >
        {t("pinned")}
      </p>
      <SidebarMenu
        data-slot="unread-inbox-pinned"
        aria-labelledby={inboxPinnedLabelId}
        className="gap-0"
      >
        {rooms.map((room) => (
          <ChatRoomSidebarRow key={room.id} {...roomRowProps(room)} />
        ))}
      </SidebarMenu>
    </div>
  );
}
