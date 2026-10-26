import { createRoute, z } from "@hono/zod-openapi";
import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
import { readMessageResultSnapshots } from "@/helpers/chat-result-metadata";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatResultPreviewSchema } from "@/schemas/chat-result-preview.schema";
import {
  hydrateChatResultSnapshots,
  prepareChatResultReads,
} from "@/services/chat-result-preview.service";
import { requireChatRoomUserMembership } from "../../helpers";

/** One page of rendered rows; a room page holds up to 100 messages. */
const MESSAGE_RESULTS_BATCH_LIMIT = 50;

const messageIdsSchema = z
  .string()
  .transform((value) => [...new Set(value.split(",").map((id) => id.trim()))])
  .pipe(z.array(z.string().uuid()).min(1).max(MESSAGE_RESULTS_BATCH_LIMIT));

const roomMessageResultsSchema = z
  .object({
    messageId: z.string().uuid(),
    results: z.array(chatResultPreviewSchema),
  })
  .openapi("ChatRoomMessageResults");

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/message-results",
    operationId: "getChatRoomMessageResultsBatch",
    tags: ["Chat Rooms"],
    request: {
      params: z.object({ id: z.string().uuid() }),
      query: z.object({
        messageIds: messageIdsSchema.openapi({
          type: "string",
          description: `Comma-separated message ids, at most ${MESSAGE_RESULTS_BATCH_LIMIT}.`,
        }),
      }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(roomMessageResultsSchema),
        "Authorized recorded results for each live message; missing, deleted or unhydratable messages are omitted",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Invalid message ids"),
      429: jsonErrorResponse("Read budget exceeded"),
    },
  }),
);

/** Results for every rendered result message in one read (one budget token). */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const auth = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { messageIds } = c.req.valid("query");
    await requireChatRoomUserMembership(id, auth.userId, prisma);
    await assertChatMessageReadBudget(auth.userId);
    const messages = await prisma.chatRoomMessage.findMany({
      where: { id: { in: messageIds }, roomId: id, deletedAt: null },
      select: { id: true, metadata: true },
    });
    const groups = messages.map((message) => ({
      messageId: message.id,
      snapshots: readMessageResultSnapshots(message.metadata),
    }));
    const prepared = await prepareChatResultReads(
      groups.flatMap((group) => group.snapshots),
      auth.userId,
    );
    // One message failing to hydrate is omitted, so only its card errors.
    const settled = await Promise.allSettled(
      groups.map(async (group) => ({
        messageId: group.messageId,
        results: await hydrateChatResultSnapshots(
          group.snapshots,
          auth.userId,
          prepared,
        ),
      })),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        console.error("Failed to hydrate chat message results", outcome.reason);
      }
    }
    return ok(
      c,
      settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      ),
    );
  });
}
