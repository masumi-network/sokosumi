import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import {
  createAvatarDraftBody,
  createAvatarDraftResponses,
  getAvatarStudioResponses,
  keepAvatarDraftResponses,
  respondWithAvatarDraft,
  respondWithAvatarStudio,
  respondWithKeptAvatar,
} from "@/helpers/soko-bot-avatar-studio-api";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { keepSokoBotAvatarDraftParamsSchema } from "@/schemas/soko-bot-avatar.schema";
import { botParams } from "../../helpers.js";

const tags = ["Admin"];

const studioRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}/avatar",
  operationId: "getAdminSokoBotAvatarStudio",
  tags,
  request: { params: botParams },
  responses: getAvatarStudioResponses,
});

const createDraftRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar/drafts",
  operationId: "createAdminSokoBotAvatarDraft",
  tags,
  request: { params: botParams, body: createAvatarDraftBody },
  responses: createAvatarDraftResponses,
});

const keepDraftRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar/drafts/{draftId}/keep",
  operationId: "keepAdminSokoBotAvatarDraft",
  tags,
  request: { params: botParams.merge(keepSokoBotAvatarDraftParamsSchema) },
  responses: keepAvatarDraftResponses,
});

async function requireBot(sokoBotId: string): Promise<string> {
  const bot = await prisma.sokoBot.findFirst({
    where: { id: sokoBotId, deletedAt: null },
    select: { id: true },
  });
  if (!bot) throw notFound("Soko Bot not found");
  return bot.id;
}

/**
 * Staff run the same studio as the person editing, for any bot. Drafting
 * spends the staff member's hourly allowance; keeping spends no daily one.
 */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(studioRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const sokoBotId = await requireBot(c.req.valid("param").sokoBotId);
    return await respondWithAvatarStudio(c, sokoBotId);
  });
  app.openapi(createDraftRoute, async (c) => {
    const { userId } = requireAdminAuthContext(c.var.authContext);
    const sokoBotId = await requireBot(c.req.valid("param").sokoBotId);
    const { change, draftId } = c.req.valid("json");
    return await respondWithAvatarDraft(c, {
      sokoBotId,
      userId,
      change,
      draftId,
    });
  });
  app.openapi(keepDraftRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const params = c.req.valid("param");
    const sokoBotId = await requireBot(params.sokoBotId);
    return await respondWithKeptAvatar(c, {
      sokoBotId,
      draftId: params.draftId,
      userId: null,
    });
  });
}
