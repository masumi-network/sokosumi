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
import {
  type EnvVariables,
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createSokoBotAvatarDraftRequestSchema,
  keepSokoBotAvatarDraftParamsSchema,
  sokoBotAvatarDraftResultSchema,
  sokoBotAvatarStudioSchema,
} from "@/schemas/soko-bot-avatar.schema";
import {
  createAvatarDraft,
  getAvatarStudio,
  keepAvatarDraft,
} from "@/services/soko-bot-avatar-studio.service";
import { sokoBotIdParams, sokoBotIdSelector } from "./bot-selector.js";

/**
 * The avatar studio for the caller's own Soko Bot (`/me/avatar`) and for a
 * shared bot by id. Changing a look needs the right to manage the bot: its
 * owner for a personal bot, an organization OWNER or ADMIN for a shared one.
 * Everyone else sees the avatar on the bot itself and cannot edit it.
 */

const bodyOf = {
  required: true,
  content: {
    "application/json": { schema: createSokoBotAvatarDraftRequestSchema },
  },
};

const studioResponses = {
  200: jsonSuccessResponse(
    sokoBotAvatarStudioSchema,
    "The bot's look, its newest draft and render progress",
  ),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

const createResponses = {
  200: jsonSuccessResponse(
    sokoBotAvatarDraftResultSchema,
    "The new draft, or the rewriter's note when nothing changed",
  ),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
  429: jsonErrorResponse("Too Many Requests"),
  503: jsonErrorResponse("Service Unavailable"),
};

const keepResponses = {
  200: jsonSuccessResponse(
    sokoBotAvatarStudioSchema,
    "The bot with its new look; its states render in the background",
  ),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
  429: jsonErrorResponse("Too Many Requests"),
};

const tags = ["Soko Bots"];

const getMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/me/avatar",
    operationId: "getMySokoBotAvatarStudio",
    tags,
    responses: studioResponses,
  }),
);
const createMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/me/avatar/drafts",
    operationId: "createMySokoBotAvatarDraft",
    tags,
    request: { body: bodyOf },
    responses: createResponses,
  }),
);
const keepMeRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/me/avatar/drafts/{draftId}/keep",
    operationId: "keepMySokoBotAvatarDraft",
    tags,
    request: { params: keepSokoBotAvatarDraftParamsSchema },
    responses: keepResponses,
  }),
);
const getByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{sokoBotId}/avatar",
    operationId: "getSokoBotAvatarStudio",
    tags,
    request: { params: sokoBotIdParams },
    responses: studioResponses,
  }),
);
const createByIdRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{sokoBotId}/avatar/drafts",
    operationId: "createSokoBotAvatarDraft",
    tags,
    request: { params: sokoBotIdParams, body: bodyOf },
    responses: createResponses,
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
    responses: keepResponses,
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
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
  app.openapi(createMeRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(c, ME_SOKO_BOT);
    const { change, draftId } = c.req.valid("json");
    return ok(
      c,
      sokoBotAvatarDraftResultSchema.parse(
        await createAvatarDraft({ sokoBotId, userId, change, draftId }),
      ),
    );
  });
  app.openapi(keepMeRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(c, ME_SOKO_BOT);
    await keepAvatarDraft({
      sokoBotId,
      userId,
      draftId: c.req.valid("param").draftId,
    });
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
}

/** `/{sokoBotId}` routes: mounted after every static `/me` and `/team` route. */
export function mountSokoBotAvatarStudioByIdRoutes(app: OpenAPIHonoWithAuth) {
  app.openapi(getByIdRoute, async (c) => {
    const { sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
  app.openapi(createByIdRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    const { change, draftId } = c.req.valid("json");
    return ok(
      c,
      sokoBotAvatarDraftResultSchema.parse(
        await createAvatarDraft({ sokoBotId, userId, change, draftId }),
      ),
    );
  });
  app.openapi(keepByIdRoute, async (c) => {
    const { userId, sokoBotId } = await managedBot(
      c,
      sokoBotIdSelector(c.req.valid("param")),
    );
    await keepAvatarDraft({
      sokoBotId,
      userId,
      draftId: c.req.valid("param").draftId,
    });
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
}
