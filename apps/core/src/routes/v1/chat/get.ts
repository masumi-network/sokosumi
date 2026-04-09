import { createRoute, z } from "@hono/zod-openapi";
import { validateUIMessages } from "ai";
import { conversationItemsToUiMessages } from "@/helpers/conversation-items-to-ui-messages";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "Load persisted messages as AI SDK UIMessage[] for the chat UI (same source as POST /chat persistence).",
  tags: ["Chat"],
  request: {
    query: z.object({
      conversationId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "UIMessages for the conversation",
      content: {
        "application/json": {
          schema: z.object({
            messages: z.array(z.unknown()),
          }),
        },
      },
    },
    400: jsonErrorResponse("Invalid request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Conversation not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(withGlobalHeaderParameters(route), async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { conversationId } = c.req.valid("query");

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: authContext.userId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!conversation) {
      throw notFound("Conversation not found");
    }

    const items = await prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, role: true, contentText: true },
    });

    const messages = conversationItemsToUiMessages(items);
    try {
      await validateUIMessages({ messages });
    } catch (error) {
      throw badRequest(
        error instanceof Error
          ? error.message
          : "Stored messages failed AI SDK validation.",
      );
    }

    return c.json({ messages }, 200);
  });
}
