"use client";

import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useOpenCoworkerRoom } from "@/app/chat/components/landing/use-open-coworker-room";
import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { ChatWithBotButton } from "@/app/soko-bots/components/open-bot-chat.client";
import { Button } from "@/components/ui/button";

/**
 * The one direct action on an Agents page card. Calm on purpose: a small
 * secondary button, so the card still reads as one card.
 */
const CARD_ACTION = { variant: "secondary", size: "sm" } as const;

/**
 * A shared bot talks in its room; a personal bot in a direct room. A shared
 * bot without a room has nowhere to message, so it gets no button.
 */
export function BotCardAction({
  botId,
  botName,
  shared,
  sharedRoomId,
}: {
  botId: string;
  botName: string;
  shared: boolean;
  sharedRoomId: string | null;
}) {
  const t = useTranslations("App.Agents.Directory");
  const label = t("messageName", { name: botName });
  if (sharedRoomId) {
    return (
      <Button asChild {...CARD_ACTION}>
        <Link
          href={`/chat/rooms/${encodeURIComponent(sharedRoomId)}`}
          aria-label={label}
        >
          <MessageSquare aria-hidden />
          {t("message")}
        </Link>
      </Button>
    );
  }
  if (shared) return null;
  return (
    <ChatWithBotButton
      sokoBotId={botId}
      label={t("message")}
      ariaLabel={label}
      errorLabel={t("messageError")}
      {...CARD_ACTION}
    />
  );
}

/** Chat when the Coworker chats; otherwise give it a task. */
export function CoworkerCardAction({
  coworkerId,
  coworkerName,
  canChat,
}: {
  coworkerId: string;
  coworkerName: string;
  canChat: boolean;
}) {
  const t = useTranslations("App.Agents.Directory");
  const { openCoworkerRoom, openingId } = useOpenCoworkerRoom();
  const openNewTask = useNewTaskOpener({ assigneeId: coworkerId });
  if (canChat) {
    return (
      <Button
        type="button"
        {...CARD_ACTION}
        loading={openingId === coworkerId}
        aria-label={t("chatName", { name: coworkerName })}
        onClick={() => openCoworkerRoom(coworkerId)}
      >
        <MessageSquare aria-hidden />
        {t("chat")}
      </Button>
    );
  }
  if (!openNewTask) return null;
  return (
    <Button
      type="button"
      {...CARD_ACTION}
      aria-label={t("giveTaskName", { name: coworkerName })}
      onClick={openNewTask}
    >
      <Plus aria-hidden />
      {t("giveTask")}
    </Button>
  );
}

/** New task with the agent @-mentioned, as on its profile. */
export function MarketplaceCardAction({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const t = useTranslations("App.Agents.Directory");
  const openNewTask = useNewTaskOpener({ prompt: `@${agentId} ` });
  if (!openNewTask) return null;
  return (
    <Button
      type="button"
      {...CARD_ACTION}
      aria-label={t("startTaskName", { name: agentName })}
      onClick={openNewTask}
    >
      <Plus aria-hidden />
      {t("startTask")}
    </Button>
  );
}
