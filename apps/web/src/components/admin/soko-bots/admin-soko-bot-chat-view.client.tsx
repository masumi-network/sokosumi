"use client";

import type {
  AdminSokoBotChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomMessage,
} from "@sokosumi/core-client";
import { Eye } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChannelMessageText } from "@/app/chat/components/room-message-row";
import { Button } from "@/components/ui/button";
import { loadAdminSokoBotChatPageAction } from "@/lib/actions/admin-soko-bots/action";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

const NO_COWORKERS = new Map<string, ChatRoomCoworkerParticipant>();

function senderName(message: ChatRoomMessage, botName: string | null) {
  switch (message.sender.type) {
    case "user":
      return message.sender.user.name;
    case "sokoBot":
      return message.sender.sokoBot.name || botName || "Soko Bot";
    case "coworker":
      return message.sender.coworker.name;
    default:
      return "—";
  }
}

function roomLabel(room: AdminSokoBotChatRoom) {
  return room.participants.map((person) => person.name ?? "—").join(", ");
}

/**
 * Read-only transcript of a bot's direct chats for operators. Nothing here
 * posts, joins, or marks anything read.
 */
export function AdminSokoBotChatView({
  sokoBotId,
  botName,
  rooms,
  selectedRoomId,
  initialMessages,
  initialCursor,
}: {
  sokoBotId: string;
  botName: string | null;
  rooms: AdminSokoBotChatRoom[];
  selectedRoomId: string | null;
  initialMessages: ChatRoomMessage[];
  initialCursor: string | null;
}) {
  const t = useTranslations("App.Admin.SokoBots.Detail.chat");
  const format = useFormatter();
  const [messages, setMessages] = useState(initialMessages);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, startLoading] = useTransition();

  if (!selectedRoomId) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  function loadOlder() {
    if (!cursor || !selectedRoomId) return;
    startLoading(async () => {
      const result = await loadAdminSokoBotChatPageAction({
        sokoBotId,
        roomId: selectedRoomId,
        cursor,
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("loadError"));
        return;
      }
      setMessages((current) => [...result.value.messages, ...current]);
      setCursor(result.value.nextCursor);
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {rooms.length > 1 ? (
          <nav aria-label={t("roomsNav")} className="flex flex-wrap gap-2">
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`${ADMIN_SOKO_BOTS_ROUTE}/${sokoBotId}/chat?room=${room.id}`}
                aria-current={room.id === selectedRoomId ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  room.id === selectedRoomId
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {room.isOwnerRoom
                  ? `${roomLabel(room)} · ${t("ownerRoom")}`
                  : roomLabel(room)}
              </Link>
            ))}
          </nav>
        ) : selectedRoom ? (
          <span className="text-muted-foreground text-xs">
            {selectedRoom.isOwnerRoom
              ? `${roomLabel(selectedRoom)} · ${t("ownerRoom")}`
              : roomLabel(selectedRoom)}
          </span>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Eye aria-hidden className="size-3.5" />
          {t("readOnly")}
        </span>
      </div>

      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadOlder}
            disabled={loading}
          >
            {loading ? t("loading") : t("loadOlder")}
          </Button>
        </div>
      ) : null}

      {messages.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noMessages")}</p>
      ) : (
        <ol className="divide-y rounded-lg border">
          {messages.map((message) => (
            <li key={message.id} className="space-y-1 px-4 py-3">
              <div className="flex items-baseline gap-2 text-xs">
                <span
                  className={cn(
                    "font-medium",
                    message.sender.type === "sokoBot"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {senderName(message, botName)}
                </span>
                <time
                  className="text-muted-foreground"
                  dateTime={new Date(message.createdAt).toISOString()}
                >
                  {format.dateTime(
                    new Date(message.createdAt),
                    "dateTimeShort",
                  )}
                </time>
              </div>
              {message.deletedAt ? (
                <p className="text-muted-foreground text-sm italic">
                  {t("deleted")}
                </p>
              ) : (
                <div className="text-sm">
                  <ChannelMessageText
                    content={message.content}
                    coworkersById={NO_COWORKERS}
                    coworkersBySlug={NO_COWORKERS}
                    channelLinks={[]}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
