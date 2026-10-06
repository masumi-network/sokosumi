import { createRoute, z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatResultPreviewSchema } from "@/schemas/chat-result-preview.schema";
import {
  collectTurnResultSnapshots,
  hydrateChatResultSnapshots,
} from "@/services/chat-result-preview.service";
import { turnParams } from "../../../../helpers";

const route = createRoute({
  method: "get",
  path: "/me/turns/{turnId}/results",
  operationId: "getMySokoBotTurnResults",
  tags: ["Soko Bots"],
  request: { params: turnParams },
  responses: {
    200: jsonSuccessResponse(
      z.array(chatResultPreviewSchema),
      "Authorized recorded turn results",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "private, no-store");
    const auth = requireUserAuthContext(c.var.authContext);
    const { turnId } = c.req.valid("param");
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { id: turnId, userId: auth.userId, status: "COMPLETED" },
      select: { id: true },
    });
    if (!turn) throw notFound("Result unavailable");
    return ok(
      c,
      await hydrateChatResultSnapshots(
        await collectTurnResultSnapshots(turn.id),
        auth.userId,
      ),
    );
  });
}
