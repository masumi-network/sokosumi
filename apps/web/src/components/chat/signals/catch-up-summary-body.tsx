"use client";

import type {
  ChatCatchUpItem,
  ChatCatchUpSummary,
} from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";
import { CatchUpLine } from "@/components/chat/signals/catch-up-line";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

interface CatchUpSummaryBodyProps {
  summary: ChatCatchUpSummary;
  /** Room-scoped: an item jumps in place instead of linking to its room. */
  onJump?: (messageId: string) => void;
  /** The global view also lists one written line per room. */
  showRooms?: boolean;
}

/**
 * A "while you were away": the written headline, then what needs the reader,
 * decisions, open loops and highlights, each a list of the messages behind
 * it. The written parts are a guide from a model; the lists are what Jev
 * tagged, so each item links to the message it came from.
 */
export function CatchUpSummaryBody({
  summary,
  onJump,
  showRooms = false,
}: CatchUpSummaryBodyProps) {
  const t = useTranslations("App.Channels.Signals");
  const format = useFormatter();

  return (
    <div className="flex flex-col gap-5" data-testid="catch-up-summary">
      <div className="flex flex-col gap-1.5">
        {summary.headline ? (
          <p className="text-base text-pretty">{summary.headline}</p>
        ) : null}
        <CatchUpLine
          buckets={summary.counts}
          className="text-muted-foreground"
        />
        {summary.generatedAt ? (
          <p className="text-muted-foreground text-xs">
            {t("writtenByAi", {
              time: format.relativeTime(new Date(summary.generatedAt)),
            })}
          </p>
        ) : null}
      </div>
      {showRooms && summary.rooms.length > 0 ? (
        <Section title={t("byRoom")}>
          {summary.rooms.map((room) => (
            <li key={room.roomId}>
              <Link
                href={`/chat/rooms/${encodeURIComponent(room.roomId)}`}
                className="hover:bg-muted flex flex-col gap-0.5 rounded-md px-2 py-1.5"
              >
                <span className="text-sm font-medium">{room.roomName}</span>
                <span className="text-muted-foreground text-sm text-pretty">
                  {room.line}
                </span>
              </Link>
            </li>
          ))}
        </Section>
      ) : null}
      <ItemSection
        title={t("Sections.needsYou")}
        items={summary.needsYou}
        onJump={onJump}
      />
      <ItemSection
        title={t("Sections.decisions")}
        items={summary.decisions}
        onJump={onJump}
      />
      <ItemSection
        title={t("Sections.openLoops")}
        items={summary.openLoops}
        onJump={onJump}
      />
      <ItemSection
        title={t("Sections.highlights")}
        items={summary.highlights}
        onJump={onJump}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2
        id={headingId}
        className="text-muted-foreground px-2 text-xs font-medium"
      >
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function ItemSection({
  title,
  items,
  onJump,
}: {
  title: string;
  items: readonly ChatCatchUpItem[];
  onJump?: (messageId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      {items.map((item) => (
        <li key={item.messageId}>
          <CatchUpItemRow item={item} onJump={onJump} />
        </li>
      ))}
    </Section>
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
        {item.dueAt ? (
          <span className="text-foreground shrink-0">
            {t("due", {
              date: format.dateTime(item.dueAt, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
            })}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-2 text-sm text-pretty">{item.excerpt}</span>
    </>
  );
  const className =
    "hover:bg-muted flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-start";
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
