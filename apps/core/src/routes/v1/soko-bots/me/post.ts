import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createSokoBotRequestSchema,
  sokoBotSchema,
} from "@/schemas/soko-bot.schema";
import {
  SokoBotNotFoundError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { mapBot, mapControlPlaneError } from "../helpers.js";

const createMeRoute = createRoute({
  method: "post",
  path: "/me",
  operationId: "createMySokoBot",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: { "application/json": { schema: createSokoBotRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(sokoBotSchema, "Create or reactivate Soko Bot"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(createMeRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      await sokoBotControlPlane.create({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      const bot = await sokoBotControlPlane.getForUser(
        auth.userId,
        workspace.workspaceId,
      );
      if (!bot) throw new SokoBotNotFoundError("Soko Bot was not created");
      return created(c, sokoBotSchema.parse(mapBot(bot)));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
