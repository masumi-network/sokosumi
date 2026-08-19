import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { SokoBot } from "@/lib/clients/generated/core";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { CreateSokoBotForm } from "./components/create-soko-bot-form.client";
import {
  LEGACY_HISTORY_QUERY_KEY,
  LegacyHistoryPanel,
} from "./components/legacy-history-panel";
import { PendingDecisionsPanel } from "./components/pending-decisions-panel";
import { SokoBotHeader } from "./components/soko-bot-header";
import { SokoBotMemoryPanel } from "./components/soko-bot-memory-panel";
import { SokoBotSchedulesPanel } from "./components/soko-bot-schedules-panel";
import { SokoBotSettingsPanel } from "./components/soko-bot-settings-panel";
import { TurnComposer } from "./components/turn-composer.client";
import { TurnList } from "./components/turn-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBot.Metadata");
  return { title: t("title"), description: t("description") };
}

type BotLoad = { kind: "ok"; bot: SokoBot | null } | { kind: "unavailable" };

async function loadBot(): Promise<BotLoad> {
  try {
    return { kind: "ok", bot: await sokoBotService.getMine() };
  } catch (error) {
    // Core answers 404 while the feature flag is off; surface that plainly
    // instead of the create form (which would fail the same way).
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}

function TurnListFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
    </div>
  );
}

interface SokoBotPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SokoBotPage({ searchParams }: SokoBotPageProps) {
  const [load, t, params] = await Promise.all([
    loadBot(),
    getTranslations("App.SokoBot"),
    searchParams,
  ]);
  const legacyOpen = params[LEGACY_HISTORY_QUERY_KEY] === "1";

  if (load.kind === "unavailable") {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-2">
        <Alert>
          <AlertTitle>{t("Unavailable.title")}</AlertTitle>
          <AlertDescription>{t("Unavailable.description")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const bot = load.bot;

  if (!bot) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Create.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("Create.description")}
          </p>
        </div>
        <CreateSokoBotForm />
      </div>
    );
  }

  const pendingDecisions = bot.pendingDecisions ?? [];
  const schedules = bot.schedules ?? [];
  const legacyMessages = bot.legacyMessages ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-2">
      <SokoBotHeader bot={bot} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <LegacyHistoryPanel messages={legacyMessages} open={legacyOpen} />
          <Suspense fallback={<TurnListFallback />}>
            <TurnList />
          </Suspense>
          <TurnComposer botStatus={bot.status} />
        </div>

        <aside className="space-y-4">
          <PendingDecisionsPanel decisions={pendingDecisions} />
          <SokoBotMemoryPanel bot={bot} />
          <SokoBotSchedulesPanel schedules={schedules} />
          <SokoBotSettingsPanel bot={bot} />
        </aside>
      </div>
    </div>
  );
}
