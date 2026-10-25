"use client";

import type { ChatRoomMessageSkill } from "@sokosumi/core-client";
import {
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  formatTaskAttachmentMarkdown,
} from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  ensureSokoBotDirectRoomAction,
  sendRoomMessageAction,
} from "@/app/chat/actions";
import {
  RoomComposer,
  type RoomComposerAttachment,
  type RoomComposerEditHandle,
} from "@/app/chat/components/room-composer";
import {
  buildRoomComposerMessageContent,
  isRoomComposerContentOverLimit,
  isRoomComposerEmpty,
} from "@/app/chat/components/room-helpers";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { useMountEffect } from "@/hooks/use-mount-effect";

const NO_MENTIONS = {};

interface SokoBotHomeComposerProps {
  sokoBotId: string;
  botName: string;
  /** The bot's Direct when it exists; created on first send otherwise. */
  roomId: string | null;
  header: ReactNode;
  /** What the team did in the last day, below the composer. */
  children: ReactNode;
}

/**
 * The Soko Bot home's composer. Sends through the room's own path (ensure
 * the Direct, post the message), so Core starts the same turn a message in
 * the bot's room does, then opens the room where the reply streams in.
 */
export function SokoBotHomeComposer({
  sokoBotId,
  botName,
  roomId,
  header,
  children,
}: SokoBotHomeComposerProps) {
  const t = useTranslations("App.Chat.Landing.SokoBotHome");
  const tChannels = useTranslations("App.Channels");
  const router = useRouter();
  const composerRef = useRef<RoomComposerEditHandle | null>(null);
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<RoomComposerAttachment[]>([]);
  const [skills, setSkills] = useState<ChatRoomMessageSkill[]>([]);
  const [isSending, startSending] = useTransition();

  useMountEffect(() => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      composerRef.current?.focus();
    }
  });

  async function resolveRoomId(): Promise<string | null> {
    if (roomId) return roomId;
    const room = await ensureSokoBotDirectRoomAction(sokoBotId);
    return room.ok && room.value ? room.value.id : null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = buildRoomComposerMessageContent(
      value,
      attachments,
      formatTaskAttachmentMarkdown,
    );
    if (!content || isSending) return;
    if (isRoomComposerContentOverLimit(content)) {
      toast.error(
        tChannels("composerTooLong", {
          count: content.length,
          max: CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
        }),
      );
      return;
    }

    startSending(async () => {
      const targetRoomId = await resolveRoomId();
      if (!targetRoomId) {
        toast.error(t("sendFailed"));
        return;
      }
      const sent = await sendRoomMessageAction(targetRoomId, content, [], {
        clientMessageId: crypto.randomUUID(),
        ...(skills.length > 0 && { skillIds: skills.map((s) => s.id) }),
      });
      if (!sent.ok) {
        toast.error(t("sendFailed"));
        return;
      }
      router.push(`/chat/rooms/${encodeURIComponent(targetRoomId)}`);
    });
  }

  return (
    <div className="flex min-h-full w-full min-w-0 flex-1 flex-col">
      <div className="flex w-full min-w-0 flex-1 flex-col pt-4 pb-8 md:pt-8">
        {header}
        <RoomComposer
          ref={composerRef}
          roomId={roomId ?? undefined}
          value={value}
          onValueChange={setValue}
          mentions={NO_MENTIONS}
          onSelectedKeysChange={() => {}}
          showMentionShortcut={false}
          placeholder={t("placeholder", { name: botName })}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={handleSubmit}
          isSending={isSending}
          sendDisabled={isRoomComposerEmpty(value, attachments)}
          skills={skills}
          onSkillsChange={setSkills}
        />
        {children}
      </div>
    </div>
  );
}
