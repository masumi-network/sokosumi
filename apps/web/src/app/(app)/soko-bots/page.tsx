import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { GALLERY_PAGE_SECTIONS_CLASS } from "@/components/agents/gallery-page-classes";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import {
  SokoBotsHero,
  TeamSection,
  YourAssistantSection,
} from "./components/roster";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBots");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/**
 * Laid out like the Agents page: a hero that says what a Soko Bot is, then
 * your own assistant, then everyone else's.
 */
export default async function SokoBotsPage() {
  await getSessionOrRedirect();
  const [t, team] = await Promise.all([
    getTranslations("App.SokoBots"),
    sokoBotService.getTeam().catch((error) => {
      if (error instanceof CoreApiRequestError) return null;
      throw error;
    }),
  ]);
  const me = team?.members.find((member) => member.isYou) ?? null;
  const stats = me?.bot
    ? await sokoBotService.getStats().catch(() => null)
    : null;

  return (
    <div className="w-full">
      <div className={GALLERY_PAGE_SECTIONS_CLASS}>
        {/* One tier, spaced the way the Agents hero and its gallery are. */}
        <div className="space-y-12 md:space-y-16">
          <SokoBotsHero team={team} />
          <YourAssistantSection me={me} stats={stats} />
          {team ? (
            <TeamSection team={team} />
          ) : (
            <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
