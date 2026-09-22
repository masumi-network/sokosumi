import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  introduceSokoBotRequestSchema,
  introduceSokoBotResponseSchema,
} from "@/schemas/soko-bot.schema";
import {
  introduceSokoBot,
  SokoBotIntroductionError,
} from "@/services/soko-bot-chat.service";

const introduceRoute = createRoute({
  method: "post",
  path: "/me/introduce",
  operationId: "introduceMySokoBot",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: introduceSokoBotRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      introduceSokoBotResponseSchema,
      "The bot's introduction message in its direct room",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(introduceRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await introduceSokoBot({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        roomId: c.req.valid("json").roomId,
      });
      return ok(c, introduceSokoBotResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof SokoBotIntroductionError)
        throw notFound(error.message);
      throw error;
    }
  });
}
