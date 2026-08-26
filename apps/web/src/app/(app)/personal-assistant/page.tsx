import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

import { SokoBotConsole } from "./components/console/console.client";
import { CreateState } from "./components/create-state.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBot.Metadata");
  return { title: t("title"), description: t("description") };
}

type StateLoad =
  | { kind: "ok"; state: SokoBotChatState | null }
  | { kind: "unavailable" };

async function loadState(): Promise<StateLoad> {
  try {
    return { kind: "ok", state: await sokoBotService.getChatState() };
  } catch (error) {
    // Core answers 404 while the feature flag is off; surface that plainly
    // instead of the create form (which would fail the same way).
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}

interface SokoBotPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The assistant console; the conversation itself lives in chat. */
export default async function SokoBotPage({ searchParams }: SokoBotPageProps) {
  const [session, load, t, params] = await Promise.all([
    getSessionOrRedirect(),
    loadState(),
    getTranslations("App.SokoBot"),
    searchParams,
  ]);
  const focusTurnId = typeof params.turn === "string" ? params.turn : null;
  const integrationOutcome =
    typeof params.integration === "string" ? params.integration : null;

  if (load.kind === "unavailable") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <Alert>
          <AlertTitle>{t("Unavailable.title")}</AlertTitle>
          <AlertDescription>{t("Unavailable.description")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const state = load.state;
  if (!state) {
    return <CreateState />;
  }

  const [versions, installedSkills, stats, integrations, catalog] =
    await Promise.all([
      sokoBotService.listVersions().catch(() => []),
      sokoBotService.listSkills().catch(() => []),
      sokoBotService.getStats().catch(() => null),
      sokoBotService.listIntegrations().catch(() => null),
      sokoBotService.searchIntegrationCatalog("").catch(() => []),
    ]);
  const version =
    versions.find((v) => v.id === state.bot.versionId) ?? versions[0] ?? null;
  const isAdmin = hasAdminRole(
    (session.user as typeof session.user & { role?: string | null }).role,
  );

  return (
    <SokoBotConsole
      initialState={state}
      version={version}
      installedSkills={installedSkills}
      stats={stats}
      integrations={integrations}
      catalog={catalog}
      integrationOutcome={integrationOutcome}
      userName={session.user.name ?? null}
      userImageUrl={session.user.image ?? null}
      focusTurnId={focusTurnId}
      adminHref={
        isAdmin
          ? `${ADMIN_SOKO_BOTS_ROUTE}/${encodeURIComponent(state.bot.id)}`
          : null
      }
    />
  );
}
