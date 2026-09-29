"use client";

import { ChevronRight, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Ref } from "react";

import type {
  RoomReader,
  RoomReadReceipts,
} from "@/app/chat/hooks/use-room-read-receipts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatRoomUserParticipant } from "@/lib/clients/generated/core";

import { SeenByDetail, seenByPendingFor } from "./room-seen-by-line";

/** The room's receipts, as much as a message's Seen by list needs. */
export type SeenBySource = Pick<
  RoomReadReceipts,
  "readersAsOf" | "readers" | "nonReaders"
>;

export interface SeenByList {
  readers: readonly RoomReader[];
  pending: readonly ChatRoomUserParticipant[];
}

/**
 * Who has read one message, and who has not: the faces popover's two lists,
 * for any message rather than only the newest. Null when nobody besides the
 * viewer and the author could read the room at all, so there is nothing to
 * show.
 *
 * The author is left out: posting moves their own read mark past the
 * message, so they would always count as a reader of what they wrote.
 */
export function seenByListFor(
  source: SeenBySource,
  createdAt: Date | string,
  authorId?: string,
): SeenByList | null {
  const readers = source
    .readersAsOf(createdAt)
    .filter((reader) => reader.participant.id !== authorId);
  const pending = seenByPendingFor({
    readers,
    allReaders: source.readers,
    nonReaders: source.nonReaders,
  }).filter((participant) => participant.id !== authorId);
  if (readers.length + pending.length === 0) {
    return null;
  }
  return { readers, pending };
}

function SeenByCount({ list }: { list: SeenByList }) {
  const t = useTranslations("App.Channels.SeenBy");
  return (
    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
      {t("count", {
        read: list.readers.length,
        total: list.readers.length + list.pending.length,
      })}
    </span>
  );
}

/**
 * "Seen by 2 of 3" in the message's more menu; hover or arrow-right opens the
 * list beside it. A flyout rather than a dialog: the list is a side question,
 * and the menu is already open.
 *
 * Portaled: the menu content scrolls and animates with a transform, and a
 * flyout nested inside it gets clipped by both.
 */
export function SeenBySubmenu({
  getList,
}: {
  /** Read on render, which for menu content is on open. */
  getList: () => SeenByList | null;
}) {
  const t = useTranslations("App.Channels.SeenBy");
  const list = getList();
  if (!list) {
    return null;
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className="gap-2 [&_svg:not([class*='text-'])]:text-muted-foreground"
        data-testid="message-seen-by-trigger"
      >
        <Eye className="size-4" aria-hidden />
        <span className="flex-1">{t("action")}</span>
        <SeenByCount list={list} />
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className="w-56 p-1"
          data-testid="message-seen-by-detail"
        >
          <SeenByDetail readers={list.readers} pending={list.pending} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** The same entry as a row in the touch actions sheet. */
export function SeenBySheetRow({
  ref,
  list,
  onOpen,
}: {
  ref?: Ref<HTMLButtonElement>;
  list: SeenByList;
  onOpen: () => void;
}) {
  const t = useTranslations("App.Channels.SeenBy");
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      className="h-11 justify-start gap-3 px-3"
      onClick={onOpen}
      data-testid="message-seen-by-trigger"
    >
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 text-start">{t("action")}</span>
      <SeenByCount list={list} />
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </Button>
  );
}
