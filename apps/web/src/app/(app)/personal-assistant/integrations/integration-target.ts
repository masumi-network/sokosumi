import { SOKO_BOT_ID_PARAM } from "@/lib/soko-bot/bot-id-param";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which bot an OAuth round trip was for. The connect call put a shared bot's
 * id on the return URL; `valid` is false when that parameter is there but is
 * not a bot id, so the page settles nothing.
 */
export function integrationTarget(
  params: Record<string, string | string[] | undefined>,
): { botId: string | undefined; valid: boolean } {
  const raw = params[SOKO_BOT_ID_PARAM];
  if (raw === undefined) return { botId: undefined, valid: true };
  if (typeof raw === "string" && UUID.test(raw)) {
    return { botId: raw, valid: true };
  }
  return { botId: undefined, valid: false };
}
