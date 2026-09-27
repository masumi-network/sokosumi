import { redirect } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

export const instant = false;

interface VerifyPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Composio's callback verifier. It holds every OAuth connection until this
 * page names the user that came back, so a Connect Link shared with someone
 * else cannot attach their provider account to the bot that issued the link.
 */
export default async function IntegrationVerifyPage({
  searchParams,
}: VerifyPageProps) {
  await getSessionOrRedirect();
  const params = await searchParams;
  const sessionUri =
    typeof params.session_uri === "string" ? params.session_uri : null;
  let outcome = "error";
  if (sessionUri) {
    outcome = await sokoBotService
      .completeIntegrationAuth(sessionUri)
      .then((result) => result.status.toLowerCase())
      .catch(() => "error");
  }
  redirect(`${SOKO_BOT_ROUTE}?integration=${encodeURIComponent(outcome)}`);
}
