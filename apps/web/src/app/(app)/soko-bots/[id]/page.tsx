import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SokoBotConsole } from "@/app/personal-assistant/components/console/console.client";
import { ReactivateSharedBotButton } from "@/app/soko-bots/components/reactivate-shared-bot-button.client";
import { Button } from "@/components/ui/button";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBot.Metadata");
  return { title: t("title"), description: t("description") };
}

export const instant = false;

interface SharedSokoBotPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The console of a project or workspace bot, by id. Every member sees it;
 * archive, delete and memory reset follow Core's `viewerCanManage`.
 *
 * Anything else goes to the assistant page: the viewer's own bot (history
 * links every bot by id), someone else's bot, an unknown id, no `sharedBots`
 * from Core, or Core unavailable. That page already shows the right
 * create, disabled or unavailable state, and says nothing about other bots.
 */
export default async function SharedSokoBotPage({
  params,
  searchParams,
}: SharedSokoBotPageProps) {
  const [session, { id }, query] = await Promise.all([
    getSessionOrRedirect(),
    params,
    searchParams,
  ]);
  const [summaries, state] = await Promise.all([
    sokoBotService.listShared().catch(() => null),
    sokoBotService.getChatState(id).catch(() => null),
  ]);
  // Only a shared bot the viewer reaches is listed; personal bots never are.
  const summary = summaries?.find((bot) => bot.id === id) ?? null;
  if (!summary || !state) redirect(SOKO_BOT_ROUTE);
  // An archived bot does nothing, so it gets no console to configure.
  if (summary.archivedAt) {
    const t = await getTranslations("App.SokoBots.Shared.Archived");
    return (
      <section
        className="mx-auto w-full max-w-lg space-y-3 px-4 py-12 text-center"
        data-testid="archived-shared-bot"
      >
        <h1 className="text-xl font-medium">
          {t("title", { name: summary.name?.trim() || id })}
        </h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
        <div className="flex justify-center gap-2">
          {summary.viewerCanManage ? (
            <ReactivateSharedBotButton botId={id} />
          ) : null}
          <Button asChild variant="outline">
            <Link href={SOKO_BOTS_ROUTE}>{t("back")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const focusTurnId = typeof query.turn === "string" ? query.turn : null;
  const integrationOutcome =
    typeof query.integration === "string" ? query.integration : null;
  const [stats, usage, integrations, catalog] = await Promise.all([
    sokoBotService.getStats(id).catch(() => null),
    sokoBotService.getMyUsage(id).catch(() => null),
    sokoBotService.listIntegrations(id).catch(() => null),
    sokoBotService.searchIntegrationCatalog("").catch(() => []),
  ]);

  return (
    <SokoBotConsole
      initialState={state}
      version={null}
      installedSkills={[]}
      stats={stats}
      usage={usage}
      integrations={integrations}
      catalog={catalog}
      integrationOutcome={integrationOutcome}
      userName={session.user.name ?? null}
      userImageUrl={session.user.image ?? null}
      focusTurnId={focusTurnId}
      // Shared bots exist only in organization workspaces.
      paidByOrganization
      botId={id}
      canManage={state.bot.viewerCanManage}
      sharedRoomId={summary.sharedRoomId}
      adminHref={null}
    />
  );
}
