import { SokoBotScope } from "@sokosumi/core-client";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentsSectionLink } from "@/components/agents/directory/agents-page";
import { AGENTS_PAGE_CLASS } from "@/components/agents/directory/agents-page-classes";
import { CoreAuthReadRetry } from "@/components/auth/core-auth-read-retry";
import { Button } from "@/components/ui/button";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { CreateSokoBotDialog } from "./components/create-soko-bot-dialog.client";
import { ManagedBotSections } from "./components/managed-bot-sections";
import { NotSetUpSection } from "./components/not-set-up-section";
import { loadSokoBotsManagement } from "./managed-bots";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBots");

  return {
    title: t("title"),
    description: t("description"),
  };
}

const INVITERS = new Set(["owner", "admin"]);

/**
 * Where Soko Bots are made and kept: create one, pause, archive and restore
 * them, and see who has none yet. Agents shows them all and opens their chats.
 */
export default async function SokoBotsPage() {
  await getSessionOrRedirect();
  const [t, { team, bots, projects }] = await Promise.all([
    getTranslations("App.SokoBots"),
    loadSokoBotsManagement(),
  ]);
  const organization = team?.workspace.kind === "organization";
  const me = team?.members.find((member) => member.isYou) ?? null;
  const hasOwnBot = bots.some((bot) => bot.owner.kind === "you");

  const create = projects ? (
    <CreateSokoBotDialog
      canCreatePersonal={!hasOwnBot}
      projects={projects}
      defaultScope={SokoBotScope.WORKSPACE}
    />
  ) : !hasOwnBot ? (
    <Button asChild size="sm">
      <Link href={SOKO_BOT_ROUTE}>{t("setUpOwn")}</Link>
    </Button>
  ) : null;

  return (
    <div className={AGENTS_PAGE_CLASS}>
      <h1 className="sr-only">{t("title")}</h1>
      {team ? (
        <>
          <ManagedBotSections
            title={t("manageTitle")}
            note={t(organization ? "manageNote" : "manageNotePersonal")}
            action={
              <div className="flex flex-wrap items-center gap-4">
                <AgentsSectionLink href="/agents">
                  {t("allAgents")}
                </AgentsSectionLink>
                {create}
              </div>
            }
            bots={bots}
            emptyText={t("manageEmpty")}
          />
          {organization ? (
            <NotSetUpSection
              others={team.members.filter((member) => !member.isYou)}
              canInvite={INVITERS.has(me?.role ?? "")}
            />
          ) : null}
        </>
      ) : (
        <CoreAuthReadRetry
          title={t("Unavailable.title")}
          description={t("Unavailable.description")}
          retryLabel={t("Unavailable.retry")}
        />
      )}
    </div>
  );
}
