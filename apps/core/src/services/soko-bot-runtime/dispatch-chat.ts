import {
  type ChatResultReference,
  sokoBotAskCoworkerInputSchema,
  sokoBotListRecipientsInputSchema,
  sokoBotOpenDirectChatInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotPreviewResultInputSchema,
  sokoBotReadChatInputSchema,
  sokoBotSendMessageInputSchema,
} from "@sokosumi/soko-bot";
import { resolveChatResultReference } from "@/services/chat-result-preview.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { listRecipients, sendMessage } from "./chat-message";
import { type RuntimeOperations } from "./operations";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every preview_result resource except `task` (whose id column is text) lives
 * in a Postgres UUID column; reject malformed ids before Prisma throws a raw
 * invalid-uuid error.
 */
function previewReferenceUuidRefusal(ref: ChatResultReference): string | null {
  switch (ref.kind) {
    case "task":
      return null;
    case "project_selection": {
      const bad = ref.projectIds.find((id) => !UUID_RE.test(id));
      return bad
        ? `"${bad.slice(0, 80)}" is not a valid Project UUID; copy exact projectIds from context or refresh_context.`
        : null;
    }
    case "social_post":
    case "studio_job": {
      if (!UUID_RE.test(ref.projectId)) {
        return `"${ref.projectId.slice(0, 80)}" is not a valid Project UUID; copy the exact projectId from context or tool results.`;
      }
      if (!UUID_RE.test(ref.id)) {
        return `"${ref.id.slice(0, 80)}" is not a valid ${ref.kind} UUID; copy the exact id from the tool result.`;
      }
      return null;
    }
    default:
      return UUID_RE.test(ref.id)
        ? null
        : `"${ref.id.slice(0, 80)}" is not a valid ${ref.kind} UUID; copy the exact id from context or tool results.`;
  }
}

export async function dispatchChatTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_chats":
      return runtime.listChats(authorized);

    case "read_chat": {
      const parsed = sokoBotReadChatInputSchema.parse(input.input);
      return runtime.readChat(authorized, parsed);
    }

    case "open_direct_chat": {
      const parsed = sokoBotOpenDirectChatInputSchema.parse(input.input);
      return runtime.openDirectChat(authorized, {
        ...parsed,
        toolCallId: input.toolCallId,
      });
    }

    case "ask_coworker": {
      const parsed = sokoBotAskCoworkerInputSchema.parse(input.input);
      return runtime.askCoworker(authorized, {
        ...parsed,
        toolCallId: input.toolCallId,
      });
    }

    case "send_message": {
      const parsed = sokoBotSendMessageInputSchema.parse(input.input);
      return sendMessage(runtime, authorized, {
        ...parsed,
        toolCallId: input.toolCallId,
      });
    }

    case "list_recipients": {
      const { query } = sokoBotListRecipientsInputSchema.parse(input.input);
      return listRecipients(runtime, authorized, query);
    }

    case "preview_result": {
      const { reference } = sokoBotPreviewResultInputSchema.parse(input.input);
      // A colleague's prompt cannot turn the owner's private data into a result.
      if (authorized.askedByKind !== "OWNER") {
        throw new SokoBotRuntimeAuthorizationError(
          "Result previews are prepared for the owner's requests",
        );
      }
      const uuidRefusal = previewReferenceUuidRefusal(reference);
      if (uuidRefusal) {
        throw new SokoBotRuntimeValidationError(uuidRefusal);
      }
      return resolveChatResultReference({
        reference,
        actor: {
          userId: actingMemberOf(authorized),
          workspaceId: authorized.turn.workspaceId,
          kind: "soko_bot",
        },
      });
    }

    case "post_chat": {
      const parsed = sokoBotPostChatInputSchema.parse(input.input);
      return runtime.postChat(authorized, {
        ...parsed,
        toolCallId: input.toolCallId,
      });
    }
  }
}
