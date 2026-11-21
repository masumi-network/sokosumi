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
import { flushSync } from "react-dom";
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
import { GradientBackground } from "@/components/gradient-background";
import { useFocusWhen } from "@/hooks/effects/use-focus-when";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";

const NO_MENTIONS = {};

interface SokoBotHomeComposerProps {
  sokoBotId: string;
  botName: string;
  /** The bot's Direct when it exists; created on first send otherwise. */
  roomId: string | null;
  header: ReactNode;
  /** Prompts a click puts in the composer, to edit or send. */
  suggestions: string[];
  /** What needs the reader, shown before the prompts. */
  attention: ReactNode;
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
  suggestions,
  attention,
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

  useFocusWhen(
    () => (window.innerWidth >= MOBILE_BREAKPOINT ? composerRef.current : null),
    true,
  );

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

  function suggest(prompt: string) {
    // Commit the prompt before placing the caret: a plain focus left it at
    // the start, so typing went in front of the prompt.
    flushSync(() => setValue(prompt));
    composerRef.current?.focusAtEnd();
  }

  return (
    <div className="relative isolate flex min-h-full w-full min-w-0 flex-1 flex-col items-center px-4">
      {/* Bleeds through main's p-4 to its edges, behind the greeting. */}
      <GradientBackground className="absolute -inset-x-4 -top-4 -z-10 h-[42rem]" />
      {/* The composer sits a little above the middle of the screen, as on a
          chat entry page; the day's list starts below the fold's edge.
          On a phone the floating tab bar covers the bottom of the screen, so
          the composer sits higher and the day's first row starts above the
          bar instead of under it, where a tap lands on Chats. */}
      <div className="flex w-full max-w-3xl flex-col gap-8 pt-4 md:pt-[22dvh]">
        {header}
        <div className="flex flex-col gap-4">
          <RoomComposer
            ref={composerRef}
            roomId={roomId ?? undefined}
            value={value}
            onValueChange={setValue}
            mentions={NO_MENTIONS}
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
          <div className="flex flex-wrap justify-center gap-2">
            {attention}
            {suggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => suggest(prompt)}
                className="border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center rounded-full border px-3 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="w-full max-w-3xl pt-10 pb-10 md:pt-16">{children}</div>
    </div>
  );
}
