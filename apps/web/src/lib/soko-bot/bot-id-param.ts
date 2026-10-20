import * as z from "zod";

/** Query parameter the console's route handlers read a shared bot's id from. */
export const SOKO_BOT_ID_PARAM = "botId";

const botIdSchema = z.string().uuid();

/**
 * The shared bot a console request is about. `{ botId: undefined }` when the
 * parameter is absent, which means the caller's own bot; `null` when it is
 * present but not a bot id, which the caller answers with 400.
 */
export function readBotIdParam(
  url: string,
): { botId: string | undefined } | null {
  const raw = new URL(url).searchParams.get(SOKO_BOT_ID_PARAM);
  if (raw === null) return { botId: undefined };
  const parsed = botIdSchema.safeParse(raw);
  return parsed.success ? { botId: parsed.data } : null;
}

/** `endpoint`, asking about the shared bot `botId` when there is one. */
export function withBotIdParam(endpoint: string, botId?: string | null) {
  return botId
    ? `${endpoint}?${SOKO_BOT_ID_PARAM}=${encodeURIComponent(botId)}`
    : endpoint;
}
