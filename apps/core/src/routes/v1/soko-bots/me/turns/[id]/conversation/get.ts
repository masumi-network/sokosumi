import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotConversationSchema } from "@/schemas/soko-bot.schema";
import { sokoBotConversation } from "@/services/soko-bot-conversation.service";

const route = createRoute({
  method: "get",
  path: "/me/turns/{id}/conversation",
  operationId: "getMySokoBotTurnConversation",
  tags: ["Soko Bots"],
  description:
    "How the owner's bot got an answer: the turn, its follow-ups, whom it asked, what came back, and each step's model, cost and time.",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: jsonSuccessResponse(sokoBotConversationSchema, "The conversation"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const conversation = await sokoBotConversation(c.req.valid("param").id, {
      ownerUserId: auth.userId,
    });
    if (!conversation) throw notFound("Turn not found");
    c.header("Cache-Control", "no-store");
    return ok(c, sokoBotConversationSchema.parse(conversation));
  });
}
