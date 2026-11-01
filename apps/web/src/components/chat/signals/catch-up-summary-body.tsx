"use client";

import type {
  ChatCatchUpBucket,
  ChatCatchUpItem,
  ChatCatchUpSummary,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId } from "react";
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
}

/**
 * One room's "while you were away" (the Summary popover): the written
 * headline, then what needs the reader, blockers, decisions, announcements,
 * open loops and a few highlights, each a list of the messages behind it. The written part is a guide from a model;
 * the lists are what Jev tagged, so each item links to the message it came
 * from. Each count on the line under the headline jumps to its section.
 */
export function CatchUpSummaryBody({
  summary,
  onJump,
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
            onJump={onJump}
          />
        ) : null,
      )}
    </div>
  );
}

function ItemSection({
  id,
  title,
  prominent,
  items,
  onJump,
}: {
  id: string;
  title: string;
  prominent: boolean;
  items: readonly ChatCatchUpItem[];
  onJump?: (messageId: string) => void;
}) {
  const headingId = useId();
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
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.messageId}>
            <CatchUpItemRow item={item} onJump={onJump} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CatchUpItemRow({
  item,
  onJump,
}: {
  item: ChatCatchUpItem;
  onJump?: (messageId: string) => void;
}) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const body = (
    <>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
        <span className="truncate">
          {onJump ? item.senderName : `${item.roomName} · ${item.senderName}`}
        </span>
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
    "flex w-full flex-col gap-0.5 px-2 py-1.5 text-start",
  );
  // A reply lives in its Thread, which the room-level jump cannot open, so
  // it links to the message like the global view does.
  if (onJump && item.parentMessageId == null) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onJump(item.messageId)}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      href={chatRoomMessageHref(item.roomId, item.messageId)}
      className={className}
    >
      {body}
    </Link>
  );
}

/** "Due Fri, Oct 30", or "2 days overdue" once the date has passed. */
export function DueLabel({ dueAt }: { dueAt: Date }) {
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
