"use server";

import type {
  ChatCatchUpSummary,
  ChatRoomCatchUp,
  ChatRoomMessage,
  ChatSignalRoutingSuggestion,
  ChatSignalTag,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { getTranslations } from "next-intl/server";
import { actionErrorMessage } from "@/app/chat/action-error-message";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { chatSignalsService } from "@/lib/services/chat-signals.service";

type SignalActionResult<T> = ActionResultDto<T, ActionError>;

async function run<T>(work: () => Promise<T>): Promise<SignalActionResult<T>> {
  try {
    return toActionResult(ok(await work()));
  } catch (error) {
    const t = await getTranslations("App.Channels.Signals");
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: actionErrorMessage(error, t("error")),
      }),
    );
  }
}

export async function getChatRoomCatchUpAction(
  roomId: string,
): Promise<SignalActionResult<ChatRoomCatchUp>> {
  return run(() => chatSignalsService.getRoomCatchUp(roomId));
}

export async function getChatCatchUpSummaryAction(
  roomId?: string,
): Promise<SignalActionResult<ChatCatchUpSummary>> {
  return run(() => chatSignalsService.getSummary(roomId));
}

export async function listChatRoomDecisionsAction(
  roomId: string,
  cursor?: string,
): Promise<
  SignalActionResult<{ messages: ChatRoomMessage[]; nextCursor: string | null }>
> {
  return run(() =>
    chatSignalsService.listDecisions(roomId, { cursor, limit: 20 }),
  );
}

export async function correctChatSignalTagAction(
  messageId: string,
  tag: ChatSignalTag,
  applies: boolean,
): Promise<SignalActionResult<ChatRoomMessage>> {
  return run(() => chatSignalsService.correctTag(messageId, tag, applies));
}

export async function setChatSignalLoopAction(
  messageId: string,
  loop: { closed: boolean; taskId?: string | null },
): Promise<SignalActionResult<ChatRoomMessage>> {
  return run(() => chatSignalsService.setLoop(messageId, loop));
}

export async function suggestChatCoworkersAction(
  messageId: string,
): Promise<SignalActionResult<ChatSignalRoutingSuggestion[]>> {
  return run(() => chatSignalsService.suggestCoworkers(messageId));
}
