import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";

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
import { assertSokoBotManagement } from "@/helpers/soko-bot-management";
import {
  ME_SOKO_BOT,
  memberSokoBot,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";
import {
  type EnvVariables,
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { keepSokoBotAvatarDraftParamsSchema } from "@/schemas/soko-bot-avatar.schema";
import { sokoBotIdParams, sokoBotIdSelector } from "./bot-selector.js";

/**
 * The avatar studio for the caller's own Soko Bot (`/me/avatar`) and for a
 * shared bot by id. Changing a look needs the right to manage the bot: the
 * person whose bot it is, for a personal bot, or an organization OWNER or ADMIN
 * for a shared one. Everyone else sees the avatar on the bot itself and cannot
 * edit it.
 */

const tags = ["Soko Bots"];

const getMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/me/avatar",
    operationId: "getMySokoBotAvatarStudio",
    tags,
    responses: getAvatarStudioResponses,
  }),
);
const createMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/me/avatar/drafts",
    operationId: "createMySokoBotAvatarDraft",
    tags,
    request: { body: createAvatarDraftBody },
    responses: createAvatarDraftResponses,
  }),
);
const keepMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/me/avatar/drafts/{draftId}/keep",
    operationId: "keepMySokoBotAvatarDraft",
    tags,
    request: { params: keepSokoBotAvatarDraftParamsSchema },
    responses: keepAvatarDraftResponses,
  }),
);
const getByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{sokoBotId}/avatar",
    operationId: "getSokoBotAvatarStudio",
    tags,
    request: { params: sokoBotIdParams },
    responses: getAvatarStudioResponses,
  }),
);
const createByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{sokoBotId}/avatar/drafts",
    operationId: "createSokoBotAvatarDraft",
    tags,
    request: { params: sokoBotIdParams, body: createAvatarDraftBody },
    responses: createAvatarDraftResponses,
  }),
);
const keepByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{sokoBotId}/avatar/drafts/{draftId}/keep",
    operationId: "keepSokoBotAvatarDraft",
    tags,
    request: {
      params: sokoBotIdParams.merge(keepSokoBotAvatarDraftParamsSchema),
    },
    responses: keepAvatarDraftResponses,
  }),
);

/** The caller and the bot, once the caller is allowed to change its avatar. */
async function managedBot(c: Context<EnvVariables>, selector: SokoBotSelector) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  const bot = await memberSokoBot(auth.userId, workspace.workspaceId, selector);
  if (!bot) {
    throw notFound(
      selector.kind === "me" ? "Create a Soko Bot first" : "Soko Bot not found",
    );
  }
  await assertSokoBotManagement(auth.userId, bot, "changeAvatar");
  return { userId: auth.userId, sokoBotId: bot.id };
}

export function mountSokoBotAvatarStudioMeRoutes(app: OpenAPIHonoWithAuth) {
  app.openapi(getMeRoute, async (c) => {
    const { sokoBotId } = await managedBot(c, ME_SOKO_BOT);
    return await respondWithAvatarStudio(c, sokoBotId);
  });
  app.openapi(createMeRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(c, ME_SOKO_BOT);
    const { change, draftId } = c.req.valid("json");
    return await respondWithAvatarDraft(c, {
      sokoBotId,
      userId,
      change,
      draftId,
    });
  });
  app.openapi(keepMeRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(c, ME_SOKO_BOT);
    return await respondWithKeptAvatar(c, {
      sokoBotId,
      userId,
      draftId: c.req.valid("param").draftId,
    });
  });
}

/** `/{sokoBotId}` routes: mounted after every static `/me` and `/team` route. */
export function mountSokoBotAvatarStudioByIdRoutes(app: OpenAPIHonoWithAuth) {
  app.openapi(getByIdRoute, async (c) => {
    const { sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    return await respondWithAvatarStudio(c, sokoBotId);
  });
  app.openapi(createByIdRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    const { change, draftId } = c.req.valid("json");
    return await respondWithAvatarDraft(c, {
      sokoBotId,
      userId,
      change,
      draftId,
    });
  });
  app.openapi(keepByIdRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    return await respondWithKeptAvatar(c, {
      sokoBotId,
      userId,
      draftId: c.req.valid("param").draftId,
    });
  });
}
