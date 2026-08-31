import { redirect } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

interface ReturnPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Composio sends the owner back here after OAuth; settle the state and go home. */
export default async function IntegrationReturnPage({
  searchParams,
}: ReturnPageProps) {
  await getSessionOrRedirect();
  const params = await searchParams;
  const provider = typeof params.provider === "string" ? params.provider : null;
  let outcome = "error";
  if (provider) {
    outcome = await sokoBotService
      .finalizeIntegration(provider)
      .then((status) => status.toLowerCase())
      .catch(() => "error");
  }
  redirect(`${SOKO_BOT_ROUTE}?integration=${encodeURIComponent(outcome)}`);
}
