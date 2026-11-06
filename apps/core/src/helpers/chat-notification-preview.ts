import * as Sentry from "@sentry/node";
import { buildNamedChatMessagePreview } from "@sokosumi/utils";
import { loadChatMentionNames } from "@/helpers/chat-mention-names";

interface ChatNotificationPreviewParams {
  roomId: string;
  messageId: string;
  content: string;
}

/**
 * What the reader is shown under the author and the room, or nothing.
 *
 * A mention nothing can name is taken out of the sentence, and what is left
 * reads as a whole sentence saying something else: `ping @Bob not @Carl`
 * becomes `ping not`. So a body carrying one gets no preview at all, which
 * leaves the reader the line naming the author and the room, as a deleted
 * message already does.
 *
 * Asked of the names this call actually holds rather than of whether the read
 * worked. A read that threw and a read that came back without this member
 * cost the reader the same sentence, and the second needs nothing to go
 * wrong: a member who has left the room reads exactly like one nobody could
 * look up. A body whose mentions all carry a readable slug says who either
 * way, and is shown as it is.
 */
export async function previewOf(
  params: ChatNotificationPreviewParams,
): Promise<string> {
  const mentionNames = await readMentionNames(params);

  return buildNamedChatMessagePreview(
    params.content,
    mentionNames ?? undefined,
  );
}

/**
 * The names this message's mentions stand for, or null when the read failed.
 *
 * A failed read costs the reader the preview, not the notification. It cannot
 * cost only the names: the preview takes an unnamed mention token out of the
 * sentence, so "ping @Bob not @Carl" read with no names becomes "ping not".
 * The reader is better served by the author-and-room line, which is what an
 * empty preview gives them, and which a deleted message already gives them.
 *
 * This read was once unguarded, and a mention key the soko bot column could
 * not parse threw here and cost every recipient of that message both their
 * notification center row and their banner (#4411). The key that did it is
 * filtered now. The shape that let one read speak for every recipient was
 * not, and a pool error or a statement timeout reaches this line the same way.
 */
async function readMentionNames(
  params: ChatNotificationPreviewParams,
): Promise<ReadonlyMap<string, string> | null> {
  try {
    return await loadChatMentionNames({
      roomId: params.roomId,
      content: params.content,
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        roomId: params.roomId,
        messageId: params.messageId,
        notificationType: "chat-mention-name",
      },
    });

    return null;
  }
}
