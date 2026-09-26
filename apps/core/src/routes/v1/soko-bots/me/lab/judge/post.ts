import { createRoute } from "@hono/zod-openapi";
import { badGateway, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  judgeSokoBotLabTurnRequestSchema,
  sokoBotLabVerdictSchema,
} from "@/schemas/soko-bot.schema";
import {
  judgeSokoBotLabTurn,
  sokoBotLabJudgeErrorKind,
} from "@/services/soko-bot-lab-judge.service";

const judgeLabTurnRoute = createRoute({
  method: "post",
  path: "/me/lab/judge",
  operationId: "judgeMySokoBotLabTurn",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: judgeSokoBotLabTurnRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotLabVerdictSchema, "Judge verdict"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    502: jsonErrorResponse("Bad Gateway"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(judgeLabTurnRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      const { verdict, model } = await judgeSokoBotLabTurn({
        userId: auth.userId,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotLabVerdictSchema.parse({ model, ...verdict }));
    } catch (error) {
      const kind = sokoBotLabJudgeErrorKind(error);
      if (kind === "miss") {
        throw badGateway(
          error instanceof Error ? error.message : "Judge produced no verdict",
        );
      }
      if (kind === "not_found") {
        throw notFound(error instanceof Error ? error.message : "Not Found");
      }
      throw error;
    }
  });
}
