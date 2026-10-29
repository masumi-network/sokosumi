import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
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

const botParams = z.object({
  sokoBotId: z
    .string()
    .uuid()
    .openapi({ param: { name: "sokoBotId", in: "path" } }),
});

const tags = ["Admin"];

const studioRoute = createRoute({
  method: "get",
  path: "/{sokoBotId}/avatar",
  operationId: "getAdminSokoBotAvatarStudio",
  tags,
  request: { params: botParams },
  responses: {
    200: jsonSuccessResponse(
      sokoBotAvatarStudioSchema,
      "The bot's look, its newest draft and render progress",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

const createDraftRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar/drafts",
  operationId: "createAdminSokoBotAvatarDraft",
  tags,
  request: {
    params: botParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: createSokoBotAvatarDraftRequestSchema },
      },
    },
  },
  responses: {
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
  },
});

const keepDraftRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/avatar/drafts/{draftId}/keep",
  operationId: "keepAdminSokoBotAvatarDraft",
  tags,
  request: {
    params: botParams.merge(keepSokoBotAvatarDraftParamsSchema),
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotAvatarStudioSchema,
      "The bot with its new look; its states render in the background",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
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
 * Staff run the same studio as an owner, for any bot. Drafting spends the
 * staff member's hourly allowance; keeping spends no daily one.
 */
export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(studioRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const sokoBotId = await requireBot(c.req.valid("param").sokoBotId);
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
  app.openapi(createDraftRoute, async (c) => {
    const { userId } = requireAdminAuthContext(c.var.authContext);
    const sokoBotId = await requireBot(c.req.valid("param").sokoBotId);
    const { change, draftId } = c.req.valid("json");
    return ok(
      c,
      sokoBotAvatarDraftResultSchema.parse(
        await createAvatarDraft({ sokoBotId, userId, change, draftId }),
      ),
    );
  });
  app.openapi(keepDraftRoute, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const params = c.req.valid("param");
    const sokoBotId = await requireBot(params.sokoBotId);
    await keepAvatarDraft({ sokoBotId, draftId: params.draftId, userId: null });
    return ok(
      c,
      sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
    );
  });
}
