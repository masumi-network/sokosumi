import { redirect } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sanitizeAuthRedirectPath } from "@/lib/auth/auth.utils";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { INTEGRATION_RETURN_TO_PARAM } from "@/lib/soko-bot/bot-id-param";
import { SOKO_BOT_ROUTE, sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { integrationTarget } from "../integration-target";

export const instant = false;

interface ReturnPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Composio sends the owner back here after OAuth; settle the state and go home. */
export default async function IntegrationReturnPage({
  searchParams,
}: ReturnPageProps) {
  await getSessionOrRedirect();
  const params = await searchParams;
  const target = integrationTarget(params);
  // Core settles a shared bot's connection through its verifier only, so
  // there is nothing to finalize here: show the console and its list.
  if (target.botId) redirect(sokoBotConsoleRoute(target.botId));
  const provider = typeof params.provider === "string" ? params.provider : null;
  let outcome = "error";
  if (provider && target.valid) {
    outcome = await sokoBotService
      .finalizeIntegration(provider)
      .then((status) => status.toLowerCase())
      .catch(() => "error");
  }
  // First-run setup connects from its own page and continues in the chat.
  const next = params[INTEGRATION_RETURN_TO_PARAM];
  if (typeof next === "string") redirect(sanitizeAuthRedirectPath(next));
  redirect(`${SOKO_BOT_ROUTE}?integration=${encodeURIComponent(outcome)}`);
}
