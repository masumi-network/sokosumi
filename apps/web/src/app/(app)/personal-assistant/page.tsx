import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

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

  if (!load.state) {
    return <CreateState userId={session.user.id} />;
  }

  return (
    <SokoBotConsole
      initialState={load.state}
      userName={session.user.name ?? null}
      userImageUrl={session.user.image ?? null}
      focusTurnId={focusTurnId}
      isAdmin={hasAdminRole(
        (session.user as { role?: string | null }).role ?? null,
      )}
    />
  );
}
