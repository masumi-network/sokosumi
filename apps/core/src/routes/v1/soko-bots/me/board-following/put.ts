import { createRoute, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotSchema,
  updateSokoBotBoardFollowingRequestSchema,
} from "@/schemas/soko-bot.schema";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";
import { mapBot } from "../../helpers.js";

const body = {
  content: {
    "application/json": { schema: updateSokoBotBoardFollowingRequestSchema },
  },
};

const spec = {
  method: "put" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new setting"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
};

const updateBoardFollowingRoute = createRoute({
  ...spec,
  path: "/me/board-following",
  operationId: "updateMySokoBotBoardFollowing",
  request: { body },
});

const updateBoardFollowingByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/board-following",
  operationId: "updateSokoBotBoardFollowing",
  request: { body, params: sokoBotIdParams },
});

/** Configuring needs only access: any member may change a shared bot's. */
async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  input: z.infer<typeof updateSokoBotBoardFollowingRequestSchema>,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await memberSokoBot(auth.userId, workspace.workspaceId, selector);
  const updated = bot
    ? await prisma.sokoBot.updateMany({
        where: { id: bot.id, archivedAt: null },
        data: { followWholeBoard: input.enabled },
      })
    : { count: 0 };
  if (updated.count === 0) throw notFound("Create a Soko Bot first");
  const refreshed = await getSokoBotState(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateBoardFollowingRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("json")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(updateBoardFollowingByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param")), c.req.valid("json")),
  );
}
