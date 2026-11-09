import { createRoute, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { assertSokoBotManagement } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotSchema } from "@/schemas/soko-bot.schema";
import { renameSokoBotRequestSchema } from "@/schemas/soko-bot-scope.schema";
import { getSokoBotState } from "@/services/soko-bot-state.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";
import { mapBot } from "../../helpers.js";

const body = {
  content: {
    "application/json": { schema: renameSokoBotRequestSchema },
  },
};

const spec = {
  method: "put" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotSchema, "Bot with its new name"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: a shared Soko Bot needs an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
  },
};

const renameMeRoute = createRoute({
  ...spec,
  path: "/me/name",
  operationId: "renameMySokoBot",
  request: { body },
});

const renameByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/name",
  operationId: "renameSokoBot",
  request: { body, params: sokoBotIdParams },
});

/**
 * Renaming is managing, like changing the avatar: a personal bot's owner, or
 * an organization owner or admin for a shared bot. Every place a bot is shown
 * reads `name` live, so one write renames it everywhere.
 */
async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  input: z.infer<typeof renameSokoBotRequestSchema>,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await memberSokoBot(auth.userId, workspace.workspaceId, selector);
  if (!bot) throw notFound("Soko Bot not found");
  await assertSokoBotManagement(auth.userId, bot, "rename");
  const updated = await prisma.sokoBot.updateMany({
    where: { id: bot.id, archivedAt: null },
    data: { name: input.name },
  });
  if (updated.count === 0) throw notFound("Soko Bot not found");
  const refreshed = await getSokoBotState(
    auth.userId,
    workspace.workspaceId,
    selector,
  );
  return ok(c, sokoBotSchema.parse(mapBot(refreshed)));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(renameMeRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("json")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(renameByIdRoute, (c) =>
    handle(c, sokoBotIdSelector(c.req.valid("param")), c.req.valid("json")),
  );
}
