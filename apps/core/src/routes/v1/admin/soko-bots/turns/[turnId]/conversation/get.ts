import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { turnParams } from "@/routes/v1/soko-bots/helpers";
import { sokoBotConversationSchema } from "@/schemas/soko-bot.schema";
import { sokoBotConversation } from "@/services/soko-bot-conversation.service";

const route = createRoute({
  method: "get",
  path: "/turns/{turnId}/conversation",
  operationId: "getAdminSokoBotTurnConversation",
  tags: ["Admin"],
  description:
    "Any bot's conversation around a turn: who asked whom, each step, model, cost and time.",
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(sokoBotConversationSchema, "The conversation"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const conversation = await sokoBotConversation(c.req.valid("param").turnId);
    if (!conversation) throw notFound("Turn not found");
    c.header("Cache-Control", "no-store");
    return ok(c, sokoBotConversationSchema.parse(conversation));
  });
}
