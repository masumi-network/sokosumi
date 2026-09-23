import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  simulateSokoBotTaskEventRequestSchema,
  sokoBotLabTaskEventSchema,
} from "@/schemas/soko-bot.schema";
import {
  SokoBotLabError,
  simulateSokoBotTaskEvent,
} from "@/services/soko-bot-lab.service";
import { mapControlPlaneError } from "../../../helpers.js";

const simulateTaskEventRoute = createRoute({
  method: "post",
  path: "/me/lab/task-event",
  operationId: "simulateMySokoBotTaskEvent",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: simulateSokoBotTaskEventRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotLabTaskEventSchema, "Simulated event"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Soko Bot cannot take a turn right now"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(simulateTaskEventRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await simulateSokoBotTaskEvent({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotLabTaskEventSchema.parse(result));
    } catch (error) {
      if (error instanceof SokoBotLabError) throw notFound(error.message);
      // It starts a real turn now, so the reasons one can be refused — at its
      // daily limit, unprompted work paused, already working, out of credits —
      // are mapped the same way the turn route maps them, and reach the lab as
      // a message rather than as a timeout.
      mapControlPlaneError(error);
    }
  });
}
