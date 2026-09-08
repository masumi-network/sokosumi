"use server";

import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { chatRoomService } from "@/lib/services/chat-room.service";
import { actionErrorMessage } from "./action-error-message";

export async function getRoomMessageAction(
  roomId: string,
  messageId: string,
): Promise<ActionResultDto<ChatRoomMessage | null, ActionError>> {
  try {
    return toActionResult(
      ok(await chatRoomService.getMessage(roomId, messageId)),
    );
  } catch (error) {
    return toActionResult(
      err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: actionErrorMessage(error, "Could not load message."),
      }),
    );
  }
}
