import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import {
  createAvatarDraftBody,
  createAvatarDraftResponses,
  discardAvatarDraftsResponses,
  getAvatarStudioResponses,
  keepAvatarDraftResponses,
  regenerateAvatarStateResponses,
  respondWithAvatarDraft,
  respondWithAvatarStudio,
  respondWithDiscardedDrafts,
  respondWithKeptAvatar,
  respondWithRegeneratedState,
} from "@/helpers/soko-bot-avatar-studio-api";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  keepSokoBotAvatarDraftParamsSchema,
  regenerateSokoBotAvatarStateParamsSchema,
} from "@/schemas/soko-bot-avatar.schema";
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

const discardDraftRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}/avatar/drafts/{draftId}",
  operationId: "discardAdminSokoBotAvatarDraft",
  tags,
  request: { params: botParams.merge(keepSokoBotAvatarDraftParamsSchema) },
  responses: discardAvatarDraftsResponses,
});

const discardDraftsRoute = createRoute({
  method: "delete",
  path: "/{sokoBotId}/avatar/drafts",
  operationId: "discardAdminSokoBotAvatarDrafts",
  tags,
  request: { params: botParams },
  responses: discardAvatarDraftsResponses,
});

const regenerateRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar/states/{state}/regenerate",
  operationId: "regenerateAdminSokoBotAvatarState",
  tags,
  request: {
    params: botParams.merge(regenerateSokoBotAvatarStateParamsSchema),
  },
  responses: regenerateAvatarStateResponses,
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
  app.openapi(discardDraftRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const params = c.req.valid("param");
    const sokoBotId = await requireBot(params.sokoBotId);
    return await respondWithDiscardedDrafts(c, {
      sokoBotId,
      draftId: params.draftId,
    });
  });
  app.openapi(discardDraftsRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const sokoBotId = await requireBot(c.req.valid("param").sokoBotId);
    return await respondWithDiscardedDrafts(c, { sokoBotId });
  });
  app.openapi(regenerateRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const params = c.req.valid("param");
    const sokoBotId = await requireBot(params.sokoBotId);
    // Staff spend no allowance.
    return await respondWithRegeneratedState(c, {
      sokoBotId,
      state: params.state,
      userId: null,
    });
  });
}
