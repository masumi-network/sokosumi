"use client";

import type {
  ChatCatchUpBucket,
  ChatCatchUpItem,
  ChatCatchUpSummary,
} from "@sokosumi/core-client";
import { Check } from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { setChatSignalLoopAction } from "@/app/chat/signal-actions";
import { CatchUpLine } from "@/components/chat/signals/catch-up-line";
import { POPOVER_ROW_CLASS } from "@/components/ui/popover-row-classes";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

const DAY_MS = 24 * 60 * 60 * 1000;

type SectionKey =
  | "needsYou"
  | "blockers"
  | "decisions"
  | "announcements"
  | "openLoops"
  | "highlights";

/** Most pressing first; the order the page reads in. */
const SECTIONS: readonly SectionKey[] = [
  "needsYou",
  "blockers",
  "decisions",
  "announcements",
  "openLoops",
  "highlights",
];

/** Sections whose rows can be marked done: they ask something of the reader. */
const CLOSABLE: ReadonlySet<SectionKey> = new Set(["needsYou", "openLoops"]);

/** Where a count on the catch-up line jumps to. */
function sectionOfBucket(bucket: ChatCatchUpBucket): SectionKey {
  switch (bucket) {
    case "needsYou":
      return "needsYou";
    case "escalation":
    case "urgent":
    case "blocker":
      return "blockers";
    case "decisionMade":
      return "decisions";
    case "announcement":
      return "announcements";
    default:
      return "highlights";
  }
}

/** Nothing written and nothing listed: the reader has read it all. */
export function isCatchUpSummaryEmpty(summary: ChatCatchUpSummary): boolean {
  return (
    summary.headline == null &&
    SECTIONS.every((section) => summary[section].length === 0)
  );
}

interface CatchUpSummaryBodyProps {
  summary: ChatCatchUpSummary;
  /** Room-scoped: an item jumps in place instead of linking to its room. */
  onJump?: (messageId: string) => void;
  /** After a row was marked done; the caller reloads the summary. */
  onHandled?: () => void;
}

/**
 * A "while you were away": the written headline, then what needs the reader,
 * blockers, decisions, announcements, open loops and a few highlights, each
 * a list of the messages behind it. The written part is a guide from a model;
 * the lists are what Jev tagged, so each item links to the message it came
 * from. Each count on the line under the headline jumps to its section.
 */
export function CatchUpSummaryBody({
  summary,
  onJump,
  onHandled,
}: CatchUpSummaryBodyProps) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const idPrefix = useId();
  const sectionId = (section: SectionKey) => `${idPrefix}-${section}`;
  const shown = new Set(
    SECTIONS.filter((section) => summary[section].length > 0),
  );

  return (
    <div className="flex flex-col gap-6" data-testid="catch-up-summary">
      <div className="flex flex-col gap-1.5">
        {summary.headline ? (
          <p className="text-base text-pretty">{summary.headline}</p>
        ) : null}
        <CatchUpLine
          buckets={summary.counts}
          className="text-muted-foreground"
          onSelect={(bucket) => {
            const section = sectionOfBucket(bucket);
            if (!shown.has(section)) return;
            document
              .getElementById(sectionId(section))
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        {summary.generatedAt ? (
          <p className="text-muted-foreground text-xs">
            {t("writtenByAi", {
              time: format.relativeTime(new Date(summary.generatedAt)),
            })}
          </p>
        ) : null}
      </div>
      {SECTIONS.map((section) =>
        shown.has(section) ? (
          <ItemSection
            key={section}
            id={sectionId(section)}
            title={t(`Sections.${section}`)}
            prominent={section === "needsYou"}
            items={summary[section]}
            groupByRoom={onJump == null}
            onJump={onJump}
            onHandled={CLOSABLE.has(section) ? onHandled : undefined}
          />
        ) : null,
      )}
    </div>
  );
}

/** Items by room, rooms in the order their first item appears. */
function byRoom(
  items: readonly ChatCatchUpItem[],
): { roomName: string; items: ChatCatchUpItem[] }[] {
  const rooms = new Map<
    string,
    { roomName: string; items: ChatCatchUpItem[] }
  >();
  for (const item of items) {
    const room = rooms.get(item.roomId) ?? {
      roomName: item.roomName,
      items: [],
    };
    room.items.push(item);
    rooms.set(item.roomId, room);
  }
  return [...rooms.values()];
}

function ItemSection({
  id,
  title,
  prominent,
  items,
  groupByRoom,
  onJump,
  onHandled,
}: {
  id: string;
  title: string;
  prominent: boolean;
  items: readonly ChatCatchUpItem[];
  groupByRoom: boolean;
  onJump?: (messageId: string) => void;
  onHandled?: () => void;
}) {
  const headingId = useId();
  const rows = (list: readonly ChatCatchUpItem[]) => (
    <ul className="flex flex-col">
      {list.map((item) => (
        <li key={item.messageId}>
          <CatchUpItemRow item={item} onJump={onJump} onHandled={onHandled} />
        </li>
      ))}
    </ul>
  );

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex scroll-mt-4 flex-col gap-1"
    >
      <h2
        id={headingId}
        className={cn(
          "px-2",
          prominent
            ? "text-foreground text-sm font-semibold"
            : "text-muted-foreground text-xs font-medium",
        )}
      >
        {title}
      </h2>
      {groupByRoom
        ? byRoom(items).map((room) => (
            <div key={room.roomName} className="flex flex-col">
              <h3 className="text-foreground px-2 pt-1 text-xs font-medium">
                {room.roomName}
              </h3>
              {rows(room.items)}
            </div>
          ))
        : rows(items)}
    </section>
  );
}

function CatchUpItemRow({
  item,
  onJump,
  onHandled,
}: {
  item: ChatCatchUpItem;
  onJump?: (messageId: string) => void;
  onHandled?: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const body = (
    <>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
        <span className="truncate">{item.senderName}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.createdAt.toISOString()} className="shrink-0">
          {format.relativeTime(item.createdAt)}
        </time>
        {item.dueAt ? <DueLabel dueAt={item.dueAt} /> : null}
      </span>
      {item.inReplyTo ? (
        <span className="text-muted-foreground line-clamp-1 text-xs">
          {t("inReplyTo", {
            name: item.inReplyTo.senderName,
            text: item.inReplyTo.excerpt,
          })}
        </span>
      ) : null}
      <span className="line-clamp-2 text-sm text-pretty">{item.excerpt}</span>
    </>
  );
  const className = cn(
    POPOVER_ROW_CLASS,
    "flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5 text-start",
  );
  // A reply lives in its Thread, which the room-level jump cannot open, so
  // it links to the message like the global view does.
  const row =
    onJump && item.parentMessageId == null ? (
      <button
        type="button"
        className={className}
        onClick={() => onJump(item.messageId)}
      >
        {body}
      </button>
    ) : (
      <Link
        href={chatRoomMessageHref(item.roomId, item.messageId)}
        className={className}
      >
        {body}
      </Link>
    );
  if (!onHandled) return row;
  return (
    <div className="group/row flex items-start gap-1">
      {row}
      <DoneButton messageId={item.messageId} onHandled={onHandled} />
    </div>
  );
}

/** "Due Fri, Oct 30", or "2 days overdue" once the date has passed. */
function DueLabel({ dueAt }: { dueAt: Date }) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const overdueDays = Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS);
  if (overdueDays >= 1) {
    return (
      <span className="text-destructive shrink-0 font-medium">
        {t("overdue", { count: overdueDays })}
      </span>
    );
  }
  return (
    <span className="text-foreground shrink-0">
      {t("due", {
        date: format.dateTime(dueAt, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
      })}
    </span>
  );
}

/** Closes the loop for everyone: the row leaves every catch-up. */
function DoneButton({
  messageId,
  onHandled,
}: {
  messageId: string;
  onHandled: () => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("markDone")}
      title={t("markDone")}
      disabled={pending}
      aria-busy={pending}
      onClick={async () => {
        setPending(true);
        const result = await setChatSignalLoopAction(messageId, {
          closed: true,
        });
        setPending(false);
        if (result.ok) onHandled();
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring mt-1.5 grid size-7 shrink-0 place-items-center rounded-md opacity-100 outline-none focus-visible:ring-2 disabled:opacity-50 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100"
    >
      <Check className="size-4" aria-hidden />
    </button>
  );
}
