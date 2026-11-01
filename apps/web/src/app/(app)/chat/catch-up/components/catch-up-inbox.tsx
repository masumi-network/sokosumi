"use client";

import type {
  ChatCatchUpItem,
  ChatCatchUpSummary,
} from "@sokosumi/core-client";
import { Check, CheckCheck, Hash } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { markAllChatUnreadReadAction } from "@/app/chat/actions";
import { setChatSignalLoopAction } from "@/app/chat/signal-actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { CatchUpLine } from "@/components/chat/signals/catch-up-line";
import { DueLabel } from "@/components/chat/signals/catch-up-summary-body";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";
import { getInitials } from "@/lib/utils/text";

interface RoomRead {
  roomId: string;
  readRoom: boolean;
  lookThreads: boolean;
}

/** What reading these items takes: the room for a message, its Threads for a reply. */
export function roomReads(items: readonly ChatCatchUpItem[]): RoomRead[] {
  const rooms = new Map<string, RoomRead>();
  for (const item of items) {
    const room = rooms.get(item.roomId) ?? {
      roomId: item.roomId,
      readRoom: false,
      lookThreads: false,
    };
    if (item.parentMessageId) room.lookThreads = true;
    else room.readRoom = true;
    rooms.set(item.roomId, room);
  }
  return [...rooms.values()];
}

/** Everything unread the summary lists; open loops are already read. */
export function unreadItems(summary: ChatCatchUpSummary): ChatCatchUpItem[] {
  return [
    ...summary.needsYou,
    ...summary.blockers,
    ...summary.decisions,
    ...summary.announcements,
    ...summary.highlights,
  ];
}

/** The unread items other than what needs the reader, by room. */
function roomGroups(summary: ChatCatchUpSummary) {
  const rooms = new Map<
    string,
    { roomId: string; roomName: string; items: ChatCatchUpItem[] }
  >();
  for (const item of [
    ...summary.blockers,
    ...summary.decisions,
    ...summary.announcements,
    ...summary.highlights,
  ]) {
    const room = rooms.get(item.roomId) ?? {
      roomId: item.roomId,
      roomName: item.roomName,
      items: [],
    };
    room.items.push(item);
    rooms.set(item.roomId, room);
  }
  return [...rooms.values()];
}

function useMarkRead(onDone: () => void) {
  const t = useTranslations("App.Channels.Signals");
  const [isMarking, startMarking] = useTransition();
  const markRead = (reads: RoomRead[]) =>
    startMarking(async () => {
      const result = await markAllChatUnreadReadAction(reads);
      if (!result.ok) toast.error(t("markAllReadError"));
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      onDone();
    });
  return { isMarking, markRead };
}

/**
 * The written headline with its counts, and the one button that clears it
 * all. Sits at the top of the page, full width.
 */
export function CatchUpHeader({
  summary,
  onChanged,
}: {
  summary: ChatCatchUpSummary;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const { isMarking, markRead } = useMarkRead(onChanged);
  const reads = roomReads(unreadItems(summary));

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        {summary.headline ? (
          <p className="text-lg font-medium text-pretty">{summary.headline}</p>
        ) : null}
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
          <CatchUpLine buckets={summary.counts} />
          {summary.generatedAt ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {t("writtenByAi", {
                  time: format.relativeTime(new Date(summary.generatedAt)),
                })}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {reads.length > 0 ? (
        <Button
          size="sm"
          className="shrink-0 self-start"
          loading={isMarking}
          onClick={() => markRead(reads)}
        >
          <CheckCheck aria-hidden />
          {t("markAllRead")}
        </Button>
      ) : null}
    </div>
  );
}

function SenderAvatar({
  item,
  className,
}: {
  item: ChatCatchUpItem;
  className: string;
}) {
  return (
    <Avatar className={cn("shrink-0", className)}>
      <AvatarImage src={item.senderImageUrl ?? undefined} alt="" />
      <AvatarFallback className="bg-muted text-muted-foreground text-2xs">
        {getInitials(item.senderName).slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Closes the loop for everyone, so it leaves every catch-up. */
function DoneButton({
  messageId,
  onDone,
}: {
  messageId: string;
  onDone: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const result = await setChatSignalLoopAction(messageId, {
          closed: true,
        });
        setPending(false);
        if (result.ok) onDone();
        else toast.error(t("error"));
      }}
    >
      <Check aria-hidden />
      {t("done")}
    </Button>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 px-2 pt-1 pb-2 text-sm font-semibold">
      {title}
      <span className="text-muted-foreground font-normal tabular-nums">
        {count}
      </span>
    </h2>
  );
}

/**
 * What asks the reader something, one card each: who, where, the message,
 * and the two ways out, open it or mark it done.
 */
export function NeedsYouList({
  items,
  onChanged,
}: {
  items: readonly ChatCatchUpItem[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  if (items.length === 0) return null;
  return (
    <section aria-label={t("Sections.needsYou")} className={HOLDER_CLASS}>
      <SectionHeading title={t("Sections.needsYou")} count={items.length} />
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.messageId}
            className={cn(HOLDER_ITEM_CLASS, "flex gap-3 p-3 md:p-4")}
          >
            <SenderAvatar item={item} className="size-8" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold">{item.senderName}</span>
                <span className="text-muted-foreground inline-flex items-center gap-0.5">
                  <Hash className="size-3" aria-hidden />
                  {item.roomName}
                </span>
                <time
                  dateTime={item.createdAt.toISOString()}
                  className="text-muted-foreground text-xs"
                >
                  {format.relativeTime(item.createdAt)}
                </time>
              </p>
              <p className="line-clamp-3 text-sm text-pretty">{item.excerpt}</p>
              <div className="-ml-2 flex items-center gap-1 pt-1">
                <Button asChild size="sm" variant="ghost">
                  <Link href={chatRoomMessageHref(item.roomId, item.messageId)}>
                    {t("openAndReply")}
                  </Link>
                </Button>
                <DoneButton messageId={item.messageId} onDone={onChanged} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tag the row carries, in the chips' words. */
function BucketChip({ item }: { item: ChatCatchUpItem }) {
  const t = useTranslations("App.Channels.Signals.Chips");
  if (item.bucket === "fyi" || item.bucket === "chitChat") return null;
  return (
    <span className="bg-muted text-muted-foreground text-2xs shrink-0 rounded px-1.5 py-0.5 font-medium">
      {t(item.bucket)}
    </span>
  );
}

/** One row: face, who, what kind, when, and one line of the message. */
function CompactRow({ item }: { item: ChatCatchUpItem }) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  return (
    <Link
      href={chatRoomMessageHref(item.roomId, item.messageId)}
      className={cn(
        HOLDER_ITEM_HOVER_CLASS,
        "flex gap-2.5 rounded-md px-2 py-2",
      )}
    >
      <SenderAvatar item={item} className="mt-0.5 size-6" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate font-medium">{item.senderName}</span>
          <BucketChip item={item} />
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
            {item.dueAt ? <DueLabel dueAt={item.dueAt} /> : null}
            <time
              dateTime={item.createdAt.toISOString()}
              className="text-muted-foreground"
            >
              {format.relativeTime(item.createdAt)}
            </time>
          </span>
        </span>
        {item.inReplyTo ? (
          <span className="text-muted-foreground truncate text-xs">
            {t("inReplyTo", {
              name: item.inReplyTo.senderName,
              text: item.inReplyTo.excerpt,
            })}
          </span>
        ) : null}
        <span className="text-foreground line-clamp-2 text-sm">
          {item.excerpt}
        </span>
      </span>
    </Link>
  );
}

/**
 * Everything else unread, one card per room, so reading a room is one click.
 * Two columns once there is room for them.
 */
export function RoomCards({
  summary,
  onChanged,
}: {
  summary: ChatCatchUpSummary;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const groups = roomGroups(summary);
  if (groups.length === 0) return null;
  return (
    <section aria-label={t("inYourRooms")} className={HOLDER_CLASS}>
      <SectionHeading
        title={t("inYourRooms")}
        count={groups.reduce((sum, group) => sum + group.items.length, 0)}
      />
      <ul className="grid gap-2 xl:grid-cols-2">
        {groups.map((group) => (
          <li key={group.roomId}>
            <RoomCard
              group={group}
              reads={roomReads(
                unreadItems(summary).filter(
                  (item) => item.roomId === group.roomId,
                ),
              )}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomCard({
  group,
  reads,
  onChanged,
}: {
  group: { roomId: string; roomName: string; items: ChatCatchUpItem[] };
  reads: RoomRead[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const { isMarking, markRead } = useMarkRead(onChanged);
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "flex h-full flex-col p-2")}>
      <div className="flex items-center gap-2 px-2 pt-1 pb-1">
        <Link
          href={`/chat/rooms/${encodeURIComponent(group.roomId)}`}
          className="flex min-w-0 items-center gap-1 text-sm font-semibold hover:underline"
        >
          <Hash
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
          <span className="truncate">{group.roomName}</span>
        </Link>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          loading={isMarking}
          onClick={() => markRead(reads)}
        >
          <Check aria-hidden />
          {t("markRead")}
        </Button>
      </div>
      <ul className="flex flex-col">
        {group.items.map((item) => (
          <li key={item.messageId}>
            <CompactRow item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Already read, still open: questions to the reader nobody answered and their
 * own promises past their date. Each one can be marked done.
 */
export function OpenLoopsList({
  items,
  onChanged,
}: {
  items: readonly ChatCatchUpItem[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  if (items.length === 0) return null;
  return (
    <section aria-label={t("Sections.openLoops")} className={HOLDER_CLASS}>
      <SectionHeading title={t("Sections.openLoops")} count={items.length} />
      <ul className={cn(HOLDER_ITEM_CLASS, "flex flex-col p-1")}>
        {items.map((item) => (
          <li key={item.messageId} className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <CompactRow item={item} />
            </div>
            <div className="pt-1.5 pr-1">
              <DoneButton messageId={item.messageId} onDone={onChanged} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
