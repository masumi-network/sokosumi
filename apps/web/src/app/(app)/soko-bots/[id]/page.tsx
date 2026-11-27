import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SokoBotConsole } from "@/app/personal-assistant/components/console/console.client";
import { ReactivateSharedBotButton } from "@/app/soko-bots/components/reactivate-shared-bot-button.client";
import { AgentsPageHeader } from "@/components/agents/directory/agents-page";
import {
  AGENTS_BACK_LINK_CLASS,
  AGENTS_PAGE_CLASS,
} from "@/components/agents/directory/agents-page-classes";
import { BackLink } from "@/components/back-link";
import { BotFace, botFaceSeed } from "@/components/soko-bot/bot-face";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { loadBotAdAccounts } from "@/lib/soko-bot/load-bot-ad-accounts";

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
    const name = summary.name?.trim() || id;
    return (
      <div className={AGENTS_PAGE_CLASS} data-testid="archived-shared-bot">
        <div className="flex flex-col gap-4">
          <BackLink href="/agents" className={AGENTS_BACK_LINK_CLASS}>
            <ArrowLeft aria-hidden className="size-4" />
            {t("back")}
          </BackLink>
          <AgentsPageHeader
            leading={
              <BotFace
                imageUrl={summary.avatarImageUrl}
                seed={botFaceSeed(summary)}
                alt={name}
                className="size-12 opacity-60"
              />
            }
            title={t("title", { name })}
            subtitle={t("description")}
            actions={
              // Reactivating Cuso is CMO's call (ADR 0066).
              summary.viewerCanManage && !summary.cuso ? (
                <ReactivateSharedBotButton botId={id} />
              ) : null
            }
          />
        </div>
      </div>
    );
  }

  const focusTurnId = typeof query.turn === "string" ? query.turn : null;
  // Ad accounts render behind Advanced only; each Project costs a Core call.
  const wantsAdvanced = query.view === "advanced" || focusTurnId !== null;
  const integrationOutcome =
    typeof query.integration === "string" ? query.integration : null;
  const [stats, usage, integrations, adAccounts] = await Promise.all([
    sokoBotService.getStats(id).catch(() => null),
    sokoBotService.getMyUsage(id).catch(() => null),
    sokoBotService.listIntegrations(id).catch(() => null),
    // A workspace bot has no Project, so it reads like the personal bot.
    wantsAdvanced
      ? loadBotAdAccounts({ projectId: summary.projectId ?? null }).catch(
          () => null,
        )
      : null,
  ]);

  return (
    <SokoBotConsole
      initialState={state}
      version={null}
      installedSkills={[]}
      stats={stats}
      usage={usage}
      integrations={integrations}
      integrationOutcome={integrationOutcome}
      connectProvider={typeof query.connect === "string" ? query.connect : null}
      userName={session.user.name ?? null}
      userImageUrl={session.user.image ?? null}
      focusTurnId={focusTurnId}
      // Shared bots exist only in organization workspaces.
      paidByOrganization
      botId={id}
      canManage={state.bot.viewerCanManage}
      // A live Cuso is what makes his Project a CMO Project.
      cmoProjectId={summary.cuso ? summary.projectId : null}
      sharedRoomId={summary.sharedRoomId}
      ads={
        adAccounts && {
          accounts: adAccounts,
          projectId: summary.projectId ?? null,
        }
      }
      adminHref={null}
    />
  );
}
