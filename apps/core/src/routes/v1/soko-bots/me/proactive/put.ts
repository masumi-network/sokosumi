import { createRoute, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound, unprocessableEntity } from "@/helpers/error";
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
  updateSokoBotProactiveRequestSchema,
} from "@/schemas/soko-bot.schema";
import { retimeSystemSchedules } from "@/services/soko-bot-proactive.service";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";
import { mapBot } from "../../helpers.js";

const body = {
  content: {
    "application/json": { schema: updateSokoBotProactiveRequestSchema },
  },
};

const spec = {
  method: "put" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with the new settings"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
};

const updateProactiveRoute = createRoute({
  ...spec,
  path: "/me/proactive",
  operationId: "updateMySokoBotProactive",
  request: { body },
});

const updateProactiveByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/proactive",
  operationId: "updateSokoBotProactive",
  request: { body, params: sokoBotIdParams },
});

/** Configuring needs only access: any member may change a shared bot's. */
async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  input: z.infer<typeof updateSokoBotProactiveRequestSchema>,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw unprocessableEntity("Unknown timezone");
    }
  }
  const bot = await memberSokoBot(auth.userId, workspace.workspaceId, selector);
  if (!bot || bot.archivedAt) throw notFound("Create a Soko Bot first");
  await prisma.sokoBot.update({
    where: { id: bot.id },
    data: {
      ...(input.paused !== undefined ? { proactivePaused: input.paused } : {}),
      ...(input.dailyLimit !== undefined
        ? { proactiveDailyLimit: input.dailyLimit }
        : {}),
      ...(input.timezone ? { ingestTimezone: input.timezone } : {}),
      ...(input.mailAutoRead !== undefined
        ? { mailAutoRead: input.mailAutoRead }
        : {}),
    },
  });
  if (input.timezone) await retimeSystemSchedules(bot.id, input.timezone);
  const refreshed = await getSokoBotState(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(updateProactiveRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("json")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(updateProactiveByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param")), c.req.valid("json")),
  );
}
