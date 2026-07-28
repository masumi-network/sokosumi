"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import WelcomeScreen from "@/app/chat/components/welcome-screen";
import {
  coworkerCanChat,
  findDefaultCoworker,
} from "@/app/chat/utils/coworker-utils";
import { extractMessageContent } from "@/app/chat/utils/message-utils";
import { stashPendingRoomMessage } from "@/app/chat/utils/pending-room-message";
import type {
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  Coworker,
} from "@/app/chat/utils/types";

function composeMessageText(message: ChatComposeMessage): string {
  if (typeof message === "string") {
    return message.trim();
  }
  return extractMessageContent(message).trim();
}

const noopSendMessage: UseChatHelpers<UIMessage>["sendMessage"] = async () => {
  // Welcome send goes through onSendMessage → room ensure + navigate.
};

interface ChatWelcomeClientProps {
  coworkers: Coworker[];
  userName?: string;
}

/**
 * Classic `/chat` landing: pick a coworker, send first message → create-or-get
 * direct room and open `/chat/rooms/{id}` (stream owns the reply).
 */
export function ChatWelcomeClient({
  coworkers,
  userName,
}: ChatWelcomeClientProps) {
  const t = useTranslations("App.Chat.Chat");
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [selectedCoworker, setSelectedCoworker] = useState<
    Coworker | undefined
  >(() => findDefaultCoworker(coworkers) ?? undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCoworkerChange = useCallback((coworker: Coworker | null) => {
    setSelectedCoworker(coworker ?? undefined);
  }, []);

  const handleSendMessage = useCallback(
    async (
      message: ChatComposeMessage,
      coworker?: Coworker,
      _options?: ChatComposeSubmitOptions,
    ): Promise<boolean> => {
      if (isSubmitting) {
        return false;
      }

      const content = composeMessageText(message);
      if (!content) {
        return false;
      }

      const selected =
        (coworker && coworkerCanChat(coworker) ? coworker : null) ??
        (selectedCoworker && coworkerCanChat(selectedCoworker)
          ? selectedCoworker
          : null) ??
        coworkers.find((candidate) => coworkerCanChat(candidate)) ??
        null;

      if (!selected) {
        toast.error(t("noCoworkersAvailable"));
        return false;
      }

      setIsSubmitting(true);
      try {
        const roomResult = await ensureCoworkerDirectRoomAction(selected.id);
        if (!roomResult.ok) {
          toast.error(roomResult.message);
          return false;
        }
        if (!roomResult.data) {
          toast.error(t("welcomeSendFailed"));
          return false;
        }

        stashPendingRoomMessage(roomResult.data.id, content);
        setInput("");
        router.replace(`/chat/rooms/${roomResult.data.id}`);
        router.refresh();
        return true;
      } finally {
        setIsSubmitting(false);
      }
    },
    [coworkers, isSubmitting, router, selectedCoworker, t],
  );

  return (
    <div className="-m-4 flex h-[calc(100svh-64px)] min-h-0 flex-col overflow-hidden bg-background">
      <WelcomeScreen
        mobileKeyboardOptimized
        userName={userName}
        onSendMessage={handleSendMessage}
        welcomeSendBlocked={isSubmitting}
        isTransitioning={isSubmitting}
        input={input}
        setInput={setInput}
        messages={messages}
        setMessages={setMessages}
        sendMessage={noopSendMessage}
        status="ready"
        stop={() => {}}
        coworkers={coworkers}
        initialCoworker={selectedCoworker}
        onCoworkerChange={handleCoworkerChange}
      />
    </div>
  );
}
