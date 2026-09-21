import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { sokoBotTurnFeedbackRequestSchema } from "@/schemas/soko-bot.schema";

const turnFeedbackRoute = createRoute({
  method: "post",
  path: "/me/turns/{id}/feedback",
  operationId: "sendMySokoBotTurnFeedback",
  tags: ["Soko Bots"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: sokoBotTurnFeedbackRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ useful: z.boolean() }),
      "Feedback stored",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(turnFeedbackRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const { useful } = c.req.valid("json");
    const updated = await prisma.sokoBotTurn.updateMany({
      where: { id: c.req.valid("param").id, userId: auth.userId },
      data: { ownerFeedback: useful ? 1 : -1, ownerFeedbackAt: new Date() },
    });
    if (updated.count === 0) throw notFound("Turn not found");
    return ok(c, { useful });
  });
}
