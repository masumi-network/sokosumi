import {
  getSokoBotVersion,
  sokoBotAskCoworkerInputSchema,
  sokoBotListRecipientsInputSchema,
  sokoBotOpenDirectChatInputSchema,
  sokoBotPostChatInputSchema,
  sokoBotPreviewResultInputSchema,
  sokoBotReadChatInputSchema,
  sokoBotSendMessageInputSchema,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { validateAskPolicyProjectSelection } from "@/lib/soko-bot/ask-policy-candidates";
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
      if (
        reference.kind === "project_selection" &&
        authorized.turn.source === "CHAT" &&
        authorized.turn.chainDepth === 0 &&
        getSokoBotVersion(authorized.turn.versionId).askPolicy
      ) {
        const turn = authorized.turn.parentTurnId
          ? null
          : await prisma.sokoBotTurn.findUnique({
              where: { id: authorized.turn.id },
              select: { userMessage: true },
            });
        const refusal = await validateAskPolicyProjectSelection({
          workspaceId: authorized.turn.workspaceId,
          botProjectId: authorized.turn.botProjectId ?? null,
          projectIds: reference.projectIds,
          userMessage: turn?.userMessage ?? "",
        });
        if (refusal) {
          throw new SokoBotRuntimeValidationError(refusal);
        }
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
