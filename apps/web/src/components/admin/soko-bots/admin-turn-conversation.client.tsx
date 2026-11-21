"use client";

import { SokoBotConversationButton } from "@/app/chat/components/soko-bot-conversation-dialog";
import { getAdminSokoBotTurnConversationAction } from "@/lib/actions/admin-soko-bots/action";

/** The conversation around one turn, for administrators. */
export function AdminTurnConversation({ turnId }: { turnId: string }) {
  return (
    <SokoBotConversationButton
      turnId={turnId}
      buttonClassName="size-7"
      load={getAdminSokoBotTurnConversationAction}
    />
  );
}
