import {
  sokoBotAskCoworkerInputSchema,
  sokoBotOpenDirectChatInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotPreviewResultInputSchema,
  sokoBotReadChatInputSchema,
} from "@sokosumi/soko-bot";
import { resolveChatResultReference } from "@/services/chat-result-preview.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

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

    case "preview_result": {
      const { reference } = sokoBotPreviewResultInputSchema.parse(input.input);
      // A colleague's prompt cannot turn the owner's private data into a result.
      if (authorized.askedByKind !== "OWNER") {
        throw new SokoBotRuntimeAuthorizationError(
          "Result previews are prepared for the owner's requests",
        );
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
