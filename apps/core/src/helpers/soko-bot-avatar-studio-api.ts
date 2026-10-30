import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { EnvVariables } from "@/lib/hono";
import {
  createSokoBotAvatarDraftRequestSchema,
  sokoBotAvatarDraftResultSchema,
  sokoBotAvatarStudioSchema,
} from "@/schemas/soko-bot-avatar.schema";
import { reconcileAvatarRenders } from "@/services/soko-bot-avatar-render.service";
import {
  createAvatarDraft,
  discardAvatarDrafts,
  getAvatarStudio,
  keepAvatarDraft,
  regenerateAvatarState,
} from "@/services/soko-bot-avatar-studio.service";

/**
 * What the avatar studio looks like on the wire, shared by the member routes
 * (own bot, shared bot) and the staff routes. Who may call is decided by each
 * route before it gets here.
 */

export const createAvatarDraftBody = {
  required: true,
  content: {
    "application/json": { schema: createSokoBotAvatarDraftRequestSchema },
  },
};

export const getAvatarStudioResponses = {
  200: jsonSuccessResponse(
    sokoBotAvatarStudioSchema,
    "The bot's look, its newest draft and render progress",
  ),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
};

export const createAvatarDraftResponses = {
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

/** What discarding answers: the studio as it is after, so `draft` is null. */
export const discardAvatarDraftsResponses = getAvatarStudioResponses;

export const regenerateAvatarStateResponses = {
  ...getAvatarStudioResponses,
  409: jsonErrorResponse("Conflict"),
  429: jsonErrorResponse("Too Many Requests"),
};

export const keepAvatarDraftResponses = {
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

/** The function runs 300 s; the run must end well inside what is left of it. */
const EARLY_RENDER_RUN_MS = 240_000;

/**
 * Starts the bot's renders now instead of at the next cron tick, after the
 * response. Leases keep it apart from the cron, which picks up whatever this
 * run leaves.
 */
function renderNow(sokoBotId: string) {
  const deadline = Date.now() + EARLY_RENDER_RUN_MS;
  waitUntil(
    reconcileAvatarRenders({
      sokoBotId,
      msRemaining: () => Math.max(0, deadline - Date.now()),
    }).catch((error: unknown) => {
      console.error("Soko Bot avatar early render run failed", {
        sokoBotId,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
}

export async function respondWithAvatarStudio(
  c: Context<EnvVariables>,
  sokoBotId: string,
) {
  return ok(
    c,
    sokoBotAvatarStudioSchema.parse(await getAvatarStudio(sokoBotId)),
  );
}

export async function respondWithAvatarDraft(
  c: Context<EnvVariables>,
  input: Parameters<typeof createAvatarDraft>[0],
) {
  return ok(
    c,
    sokoBotAvatarDraftResultSchema.parse(await createAvatarDraft(input)),
  );
}

/** Keeps the draft, then answers with the studio as the keep left it. */
export async function respondWithKeptAvatar(
  c: Context<EnvVariables>,
  input: Parameters<typeof keepAvatarDraft>[0],
) {
  await keepAvatarDraft(input);
  renderNow(input.sokoBotId);
  return await respondWithAvatarStudio(c, input.sokoBotId);
}

/** Discards open drafts (all of the bot's, or one), then answers with the studio. */
export async function respondWithDiscardedDrafts(
  c: Context<EnvVariables>,
  input: Parameters<typeof discardAvatarDrafts>[0],
) {
  await discardAvatarDrafts(input);
  return await respondWithAvatarStudio(c, input.sokoBotId);
}

/** Starts one state's animation over, then answers with the studio as it is. */
export async function respondWithRegeneratedState(
  c: Context<EnvVariables>,
  input: Parameters<typeof regenerateAvatarState>[0],
) {
  await regenerateAvatarState(input);
  renderNow(input.sokoBotId);
  return await respondWithAvatarStudio(c, input.sokoBotId);
}
