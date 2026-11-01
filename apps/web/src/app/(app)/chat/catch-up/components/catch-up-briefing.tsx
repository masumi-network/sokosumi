"use client";

import type {
  ChatCatchUpItem,
  ChatCatchUpSummary,
  ChatCatchUpTopic,
} from "@sokosumi/core-client";
import { Check, CheckCheck, ChevronDown, Hash, Send } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  markAllChatUnreadReadAction,
  sendRoomMessageAction,
} from "@/app/chat/actions";
import { setChatSignalLoopAction } from "@/app/chat/signal-actions";
import { chatRoomHref } from "@/app/chat/utils/chat-route-base";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";
import { DueLabel } from "@/components/chat/signals/catch-up-summary-body";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";
import { getInitials } from "@/lib/utils/text";

/** Every room with something unread. */
function unreadRoomIds(summary: ChatCatchUpSummary): string[] {
  return [
    ...new Set([
      ...summary.topics.map((topic) => topic.roomId),
      ...summary.quietRooms.map((room) => room.roomId),
    ]),
  ];
}

/** Reads each room in full: its messages and its Threads. */
function useMarkRead(onDone: () => void) {
  const t = useTranslations("App.Channels.Signals");
  const [isMarking, startMarking] = useTransition();
  const markRead = (roomIds: readonly string[]) =>
    startMarking(async () => {
      const result = await markAllChatUnreadReadAction(
        roomIds.map((roomId) => ({
          roomId,
          readRoom: true,
          lookThreads: true,
        })),
      );
      if (!result.ok) toast.error(t("markAllReadError"));
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      onDone();
    });
  return { isMarking, markRead };
}

/** Closes every question to the reader in it, for everyone in the room. */
async function closeTopic(topic: ChatCatchUpTopic): Promise<boolean> {
  const results = await Promise.all(
    topic.messages
      .filter((item) => item.bucket === "needsYou")
      .map((item) => setChatSignalLoopAction(item.messageId, { closed: true })),
  );
  return results.every((result) => result.ok);
}

/**
 * How long the reader was away and how much came in, the gist in one
 * sentence, and the one button that clears it all.
 */
export function BriefingHeader({
  summary,
  onChanged,
}: {
  summary: ChatCatchUpSummary;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals.Briefing");
  const tSignals = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const { isMarking, markRead } = useMarkRead(onChanged);
  const roomIds = unreadRoomIds(summary);
  const unread = t("unread", {
    messages: summary.unreadMessageCount,
    rooms: summary.unreadRoomCount,
  });

  return (
    <div className={HOLDER_CLASS}>
      <div
        className={cn(
          HOLDER_ITEM_CLASS,
          "flex flex-col gap-4 p-4 md:flex-row md:items-start md:justify-between md:gap-8 md:p-6",
        )}
      >
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("welcomeBack")}
          </h2>
          {summary.unreadMessageCount > 0 ? (
            <p className="text-muted-foreground text-sm">
              {summary.awaySince
                ? t("unreadSince", {
                    unread,
                    date: format.dateTime(summary.awaySince, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    }),
                  })
                : unread}
            </p>
          ) : null}
          {summary.headline ? (
            <p className="max-w-prose text-base text-pretty">
              {summary.headline}
            </p>
          ) : null}
        </div>
        {roomIds.length > 0 ? (
          <Button
            className="shrink-0 self-start"
            loading={isMarking}
            onClick={() => markRead(roomIds)}
          >
            <CheckCheck aria-hidden />
            {tSignals("markAllRead")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PersonAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl: string | null;
  className: string;
}) {
  return (
    <Avatar className={cn("shrink-0", className)}>
      <AvatarImage src={imageUrl ?? undefined} alt="" />
      <AvatarFallback className="bg-muted text-muted-foreground text-2xs">
        {getInitials(name).slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Up to three faces, overlapped, and the rest as a count. */
function People({ people }: { people: ChatCatchUpTopic["people"] }) {
  const shown = people.slice(0, 3);
  return (
    <span className="flex shrink-0 items-center -space-x-2" aria-hidden>
      {shown.map((person) => (
        <PersonAvatar
          key={person.name}
          name={person.name}
          imageUrl={person.imageUrl}
          className="ring-background size-7 ring-2"
        />
      ))}
      {people.length > shown.length ? (
        <span className="bg-muted text-muted-foreground ring-background text-2xs grid size-7 place-items-center rounded-full font-medium ring-2">
          +{people.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

function SectionHeading({
  id,
  title,
  count,
}: {
  id: string;
  title: string;
  count: number;
}) {
  return (
    <h2
      id={id}
      className="flex items-baseline gap-2 px-2 pt-1 pb-2 text-sm font-semibold"
    >
      {title}
      <span className="text-muted-foreground font-normal tabular-nums">
        {count}
      </span>
    </h2>
  );
}

/** One message behind a topic: face, who, when, and what they wrote. */
function SourceMessage({ item }: { item: ChatCatchUpItem }) {
  const format = useFormatter();
  return (
    <Link
      href={chatRoomMessageHref(item.roomId, item.messageId)}
      className={cn(
        HOLDER_ITEM_HOVER_CLASS,
        "flex gap-2.5 rounded-md px-2 py-2",
      )}
    >
      <PersonAvatar
        name={item.senderName}
        imageUrl={item.senderImageUrl}
        className="mt-0.5 size-6"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate font-medium">{item.senderName}</span>
          <time
            dateTime={item.createdAt.toISOString()}
            className="text-muted-foreground ml-auto shrink-0 text-xs"
          >
            {format.relativeTime(item.createdAt)}
          </time>
        </span>
        <span className="line-clamp-3 text-sm text-pretty">{item.excerpt}</span>
      </span>
    </Link>
  );
}

/**
 * Answers in the conversation the question came from: its Thread when it is
 * a reply, else the room. Sending closes the topic, since it is answered.
 */
function InlineReply({
  topic,
  onSent,
}: {
  topic: ChatCatchUpTopic;
  onSent: () => void;
}) {
  const t = useTranslations("App.Channels.Signals.Briefing");
  const [text, setText] = useState("");
  const [isSending, startSending] = useTransition();
  const target =
    topic.messages.findLast((item) => item.bucket === "needsYou") ??
    topic.messages.at(-1);
  if (!target) return null;
  const send = () =>
    startSending(async () => {
      const result = await sendRoomMessageAction(topic.roomId, text, [], {
        ...(target.parentMessageId && {
          parentMessageId: target.parentMessageId,
        }),
      });
      if (!result.ok) {
        toast.error(t("replyError"));
        return;
      }
      setText("");
      await closeTopic(topic);
      toast.success(t("replySent", { room: topic.roomName }));
      onSent();
    });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) send();
      }}
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && text.trim()) {
            event.preventDefault();
            send();
          }
        }}
        placeholder={t("replyPlaceholder", { name: target.senderName })}
        aria-label={t("replyPlaceholder", { name: target.senderName })}
        className="min-h-10"
        autoFocus
      />
      <Button
        type="submit"
        size="sm"
        className="self-end"
        loading={isSending}
        disabled={!text.trim()}
      >
        <Send aria-hidden />
        {t("send")}
      </Button>
    </form>
  );
}

/**
 * One subject, told as a whole: who was in it, where, what happened and where
 * it stands. The messages behind it fold out; a topic waiting on the reader
 * can be answered or marked done right here.
 */
function TopicCard({
  topic,
  onChanged,
}: {
  topic: ChatCatchUpTopic;
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals.Briefing");
  const tSignals = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const sourcesId = useId();
  const [showSources, setShowSources] = useState(false);
  const [replying, setReplying] = useState(false);
  const [isClosing, startClosing] = useTransition();
  const waits = topic.status === "waitingOnYou";
  const latest = topic.messages.at(-1);

  return (
    <article
      className={cn(HOLDER_ITEM_CLASS, "flex h-full flex-col gap-3 p-4")}
    >
      <div className="flex items-start gap-3">
        <People people={topic.people} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-base font-semibold text-pretty">{topic.title}</h3>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className="inline-flex items-center gap-0.5">
              {topic.roomKind === "channel" ? (
                <Hash className="size-3" aria-hidden />
              ) : null}
              {topic.roomName}
            </span>
            <span aria-hidden>·</span>
            <time dateTime={topic.latestAt.toISOString()}>
              {format.relativeTime(topic.latestAt)}
            </time>
            {waits ? null : (
              <>
                <span aria-hidden>·</span>
                <span>{t(`Status.${topic.status}`)}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <p className="text-sm text-pretty">{topic.summary}</p>
      {showSources ? (
        <ul id={sourcesId} className="bg-quinary flex flex-col rounded-md p-1">
          {topic.messages.map((item) => (
            <li key={item.messageId}>
              <SourceMessage item={item} />
            </li>
          ))}
        </ul>
      ) : null}
      {replying ? <InlineReply topic={topic} onSent={onChanged} /> : null}
      <div className="-ml-2 mt-auto flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showSources}
          aria-controls={sourcesId}
          onClick={() => setShowSources((shown) => !shown)}
        >
          <ChevronDown
            aria-hidden
            className={cn("transition-transform", showSources && "rotate-180")}
          />
          {t("messages", { count: topic.messages.length })}
        </Button>
        {latest ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={chatRoomMessageHref(latest.roomId, latest.messageId)}>
              {t("open")}
            </Link>
          </Button>
        ) : null}
        {waits ? (
          <>
            {replying ? null : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReplying(true)}
              >
                {t("reply")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={isClosing}
              onClick={() =>
                startClosing(async () => {
                  if (await closeTopic(topic)) onChanged();
                  else toast.error(tSignals("error"));
                })
              }
            >
              <Check aria-hidden />
              {tSignals("done")}
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The topics: first what waits on the reader, one per row so each can be
 * answered; then the rest of what happened, two columns when there is room.
 */
export function BriefingTopics({
  topics,
  onChanged,
}: {
  topics: readonly ChatCatchUpTopic[];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals.Briefing");
  const waitingId = useId();
  const awayId = useId();
  const waiting = topics.filter((topic) => topic.status === "waitingOnYou");
  const rest = topics.filter((topic) => topic.status !== "waitingOnYou");
  return (
    <>
      {waiting.length > 0 ? (
        <section aria-labelledby={waitingId} className={HOLDER_CLASS}>
          <SectionHeading
            id={waitingId}
            title={t("waitingOnYou")}
            count={waiting.length}
          />
          <ul className="flex flex-col gap-2">
            {waiting.map((topic) => (
              <li key={topic.id}>
                <TopicCard topic={topic} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section aria-labelledby={awayId} className={HOLDER_CLASS}>
          <SectionHeading
            id={awayId}
            title={t("whileAway")}
            count={rest.length}
          />
          <ul className="grid gap-2 xl:grid-cols-2">
            {rest.map((topic) => (
              <li key={topic.id}>
                <TopicCard topic={topic} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
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
  const t = useTranslations("App.Channels.Signals.Briefing");
  const tSignals = useTranslations("App.Channels.Signals");
  const format = useFormatter();
  const headingId = useId();
  const [closing, setClosing] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={HOLDER_CLASS}>
      <SectionHeading
        id={headingId}
        title={t("stillOpen")}
        count={items.length}
      />
      <ul className={cn(HOLDER_ITEM_CLASS, "flex flex-col p-1")}>
        {items.map((item) => (
          <li key={item.messageId} className="flex items-start gap-1">
            <Link
              href={chatRoomMessageHref(item.roomId, item.messageId)}
              className={cn(
                HOLDER_ITEM_HOVER_CLASS,
                "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-2",
              )}
            >
              <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                <span className="truncate">
                  {item.senderName} · {item.roomName}
                </span>
                {item.dueAt ? (
                  <DueLabel dueAt={item.dueAt} />
                ) : (
                  <time dateTime={item.createdAt.toISOString()}>
                    {format.relativeTime(item.createdAt)}
                  </time>
                )}
              </span>
              <span className="line-clamp-2 text-sm">{item.excerpt}</span>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 mr-1"
              loading={closing === item.messageId}
              onClick={async () => {
                setClosing(item.messageId);
                const result = await setChatSignalLoopAction(item.messageId, {
                  closed: true,
                });
                setClosing(null);
                if (result.ok) onChanged();
                else toast.error(tSignals("error"));
              }}
            >
              <Check aria-hidden />
              {tSignals("done")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Rooms with unread messages and nothing in them for the reader. */
export function QuietRooms({
  rooms,
  onChanged,
}: {
  rooms: ChatCatchUpSummary["quietRooms"];
  onChanged: () => void;
}) {
  const t = useTranslations("App.Channels.Signals.Briefing");
  const tSignals = useTranslations("App.Channels.Signals");
  const headingId = useId();
  const { isMarking, markRead } = useMarkRead(onChanged);
  if (rooms.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className={HOLDER_CLASS}>
      <div className="flex items-center gap-2 pr-1">
        <SectionHeading
          id={headingId}
          title={t("nothingForYou")}
          count={rooms.length}
        />
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          loading={isMarking}
          onClick={() => markRead(rooms.map((room) => room.roomId))}
        >
          <Check aria-hidden />
          {tSignals("markRead")}
        </Button>
      </div>
      <ul className={cn(HOLDER_ITEM_CLASS, "flex flex-col p-1")}>
        {rooms.map((room) => (
          <li key={room.roomId}>
            <Link
              href={chatRoomHref(room.roomId)}
              className={cn(
                HOLDER_ITEM_HOVER_CLASS,
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{room.roomName}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("unreadInRoom", { count: room.unreadCount })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
