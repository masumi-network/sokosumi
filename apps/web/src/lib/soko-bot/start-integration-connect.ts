import type { ActionError } from "@/lib/actions/errors/action-error";
import { connectSokoBotIntegrationAction } from "@/lib/actions/soko-bot/action";
import { rememberComposioBotId } from "@/lib/composio/oauth-popup-protocol";
import {
  INTEGRATION_RETURN_TO_PARAM,
  SOKO_BOT_ID_PARAM,
} from "@/lib/soko-bot/bot-id-param";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

interface StartSokoBotConnectOptions {
  /** A shared bot; the caller's own bot when absent. */
  botId?: string | null;
  /** Same-origin path to land on after OAuth instead of the console. */
  returnTo?: string;
}

/**
 * Sends the tab to Composio to connect `provider` for one bot: a shared bot
 * by id, or the caller's own bot when `botId` is absent. Every connect goes
 * through here, so the stored target is always this connect's, never one
 * left by an abandoned attempt. Returns the error when Core refuses.
 */
export async function startSokoBotConnect(
  provider: string,
  { botId, returnTo }: StartSokoBotConnectOptions = {},
): Promise<ActionError | null> {
  const returnUrl = new URL(
    `${SOKO_BOT_ROUTE}/integrations/return`,
    window.location.origin,
  );
  returnUrl.searchParams.set("provider", provider);
  if (botId) returnUrl.searchParams.set(SOKO_BOT_ID_PARAM, botId);
  if (returnTo) {
    returnUrl.searchParams.set(INTEGRATION_RETURN_TO_PARAM, returnTo);
  }
  const result = await connectSokoBotIntegrationAction({
    provider,
    returnUrl: returnUrl.toString(),
    botId: botId ?? undefined,
  });
  if (!result.ok) return result.error;
  rememberComposioBotId(botId);
  window.location.assign(result.value.redirectUrl);
  return null;
}
