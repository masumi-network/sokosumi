import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotSchema } from "@/schemas/soko-bot.schema";
import { createScopedSokoBotRequestSchema } from "@/schemas/soko-bot-scope.schema";
import {
  SokoBotNotFoundError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import {
  createSharedSokoBot,
  reactivateSharedSokoBot,
} from "@/services/soko-bot-shared-create.service";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "./bot-selector.js";
import { mapBot, mapControlPlaneError } from "./helpers.js";

const createRouteDefinition = createRoute({
  method: "post",
  path: "/",
  operationId: "createSokoBot",
  tags: ["Soko Bots"],
  description:
    "Create a Soko Bot in a scope. `personal` creates or reactivates the caller's own bot, like `POST /me`. `project` and `workspace` create a bot every member of the organization shares, with one shared room; any member may create one.",
  request: {
    body: {
      content: {
        "application/json": { schema: createScopedSokoBotRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(sokoBotSchema, "Created Soko Bot"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

const reactivateRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}",
  operationId: "reactivateSokoBot",
  tags: ["Soko Bots"],
  description:
    "Reactivate an archived project or workspace Soko Bot. Organization owners and admins only.",
  request: { params: sokoBotIdParams },
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Reactivated Soko Bot"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(createRouteDefinition, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { scope, projectId, timezone, ...body } = c.req.valid("json");
    try {
      const sokoBotId =
        scope === "personal"
          ? (
              await sokoBotControlPlane.create({
                userId: auth.userId,
                workspaceId: workspace.workspaceId,
                ...body,
              })
            ).id
          : (
              await createSharedSokoBot({
                callerUserId: auth.userId,
                workspaceId: workspace.workspaceId,
                projectId: scope === "project" ? (projectId ?? null) : null,
                timezone,
                ...body,
              })
            ).id;
      const bot = await getSokoBotState(
        auth.userId,
        workspace.workspaceId,
        sokoBotIdSelector({ sokoBotId }),
      );
      if (!bot) throw new SokoBotNotFoundError("Soko Bot was not created");
      return created(c, sokoBotSchema.parse(mapBot(bot)));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(reactivateRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const selector = sokoBotIdSelector(c.req.valid("param"));
    try {
      await reactivateSharedSokoBot(
        auth.userId,
        workspace.workspaceId,
        c.req.valid("param").sokoBotId,
      );
      const bot = await getSokoBotState(
        auth.userId,
        workspace.workspaceId,
        selector,
      );
      if (!bot) throw new SokoBotNotFoundError("Soko Bot not found");
      return ok(c, sokoBotSchema.parse(mapBot(bot)));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
