import { CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE } from "@sokosumi/utils";
import { unstable_rethrow } from "next/navigation";
import { CoreApiRequestError } from "@/lib/clients/core.client";

function isChatRoomContentTooLongError(error: unknown): boolean {
  if (!(error instanceof CoreApiRequestError)) {
    return false;
  }
  const message = error.message;
  return /content/i.test(message) && /too (big|long)/i.test(message);
}

export function actionErrorMessage(error: unknown, fallback: string): string {
  unstable_rethrow(error);

  if (isChatRoomContentTooLongError(error)) {
    return CHAT_ROOM_MESSAGE_CONTENT_TOO_LONG_MESSAGE;
  }
  if (error instanceof CoreApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
