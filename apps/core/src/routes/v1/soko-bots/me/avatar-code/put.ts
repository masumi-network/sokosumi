import { createRoute } from "@hono/zod-openapi";
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
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  setSokoBotAvatarCodeRequestSchema,
  sokoBotAvatarCodeSchema,
} from "@/schemas/soko-bot-avatar.schema";
import { setSokoBotAvatarCode } from "@/services/soko-bot-avatar-code.service";
import { sokoBotIdParams, sokoBotIdSelector } from "../../bot-selector.js";

const body = {
  content: {
    "application/json": { schema: setSokoBotAvatarCodeRequestSchema },
  },
};

const spec = {
  method: "put" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(sokoBotAvatarCodeSchema, "The bot's new look"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: a shared Soko Bot needs an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Another bot already has this look"),
    422: jsonErrorResponse("Not a valid avatar code"),
  },
};

const setMeRoute = createRoute({
  ...spec,
  path: "/me/avatar-code",
  operationId: "setMySokoBotAvatarCode",
  request: { body },
});

const setByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/avatar-code",
  operationId: "setSokoBotAvatarCode",
  request: { body, params: sokoBotIdParams },
});

/** Changing the look is managing, like renaming: the owner, or an org owner or admin for a shared bot. */
async function handle(
  c: Context<EnvVariables>,
  selector: SokoBotSelector,
  code: string,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await memberSokoBot(auth.userId, workspace.workspaceId, selector);
  if (!bot) throw notFound("Soko Bot not found");
  await assertSokoBotManagement(auth.userId, bot, "changeAvatar");
  return ok(c, await setSokoBotAvatarCode(bot.id, code));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(setMeRoute, (c) =>
    handle(c, ME_SOKO_BOT, c.req.valid("json").code),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(setByIdRoute, (c) =>
    handle(
      c,
      sokoBotIdSelector(c.req.valid("param")),
      c.req.valid("json").code,
    ),
  );
}
