import { Settings } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  botName,
  botOwnerLabel,
  botStatusLabel,
} from "@/app/agents/bot-labels";
import { PersonAvatar } from "@/app/contacts/components/contact-visuals";
import { ArchiveSokoBotButton } from "@/app/personal-assistant/components/archive-soko-bot-button.client";
import { AgentStatus } from "@/components/agents/directory/agent-status";
import {
  AgentsSection,
  AgentsTag,
} from "@/components/agents/directory/agents-page";
import { AGENTS_CARD_CLASS } from "@/components/agents/directory/agents-page-classes";
import { PageSearchRows } from "@/components/page-list-search";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ManagedBot } from "../managed-bots";
import { PauseSokoBotButton } from "./pause-soko-bot-button.client";
import { ReactivateSharedBotButton } from "./reactivate-shared-bot-button.client";

type DirectoryT = Awaited<
  ReturnType<typeof getTranslations<"App.Agents.Directory">>
>;

/** Avatar, name and one meta line on the left; the row's actions on the right. */
function BotRow({
  bot,
  name,
  meta,
  actions,
  muted = false,
}: {
  bot: ManagedBot;
  name: string;
  meta: ReactNode;
  actions: ReactNode;
  muted?: boolean;
}) {
  return (
    <li
      className={cn(
        AGENTS_CARD_CLASS,
        "flex flex-col gap-3 sm:flex-row sm:items-center",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BotFace
          imageUrl={bot.avatarImageUrl}
          seed={bot.seed}
          className={cn("size-10", muted && "opacity-60")}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-foreground truncate font-medium">{name}</span>
          <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {meta}
          </span>
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

function Owner({ bot, t }: { bot: ManagedBot; t: DirectoryT }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {bot.owner.kind === "you" ? (
        <PersonAvatar person={bot.owner} className="size-4" />
      ) : null}
      <span className="truncate">{botOwnerLabel(bot, t)}</span>
    </span>
  );
}

type SokoBotsT = Awaited<ReturnType<typeof getTranslations<"App.SokoBots">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

function LiveBotRows({
  bots,
  t,
  tDir,
}: {
  bots: ManagedBot[];
  t: SokoBotsT;
  tDir: DirectoryT;
}) {
  return (
    <ul className="flex flex-col gap-2">
      <PageSearchRows
        rows={bots.map((bot) => {
          const name = botName(bot, tDir);
          return {
            primary: [name],
            secondary: [botOwnerLabel(bot, tDir), botStatusLabel(bot, tDir)],
            content: (
              <BotRow
                key={bot.id}
                bot={bot}
                name={name}
                meta={
                  <>
                    <Owner bot={bot} t={tDir} />
                    <AgentStatus
                      status={bot.status}
                      label={botStatusLabel(bot, tDir)}
                    />
                    {bot.paused ? <AgentsTag>{t("paused")}</AgentsTag> : null}
                  </>
                }
                actions={
                  <>
                    <Button asChild size="sm">
                      <Link
                        href={bot.settingsHref}
                        aria-label={t("settingsName", { name })}
                      >
                        <Settings aria-hidden />
                        {t("settings")}
                      </Link>
                    </Button>
                    {bot.paused === null ? null : (
                      <PauseSokoBotButton
                        botId={bot.targetId}
                        name={name}
                        paused={bot.paused}
                      />
                    )}
                    {bot.canArchive ? (
                      <ArchiveSokoBotButton botId={bot.targetId} />
                    ) : null}
                  </>
                }
              />
            ),
          };
        })}
      />
    </ul>
  );
}

export function ArchivedBotRows({
  bots,
  t,
  tDir,
  format,
}: {
  bots: ManagedBot[];
  t: SokoBotsT;
  tDir: DirectoryT;
  format: Format;
}) {
  return (
    <ul className="flex flex-col gap-2">
      <PageSearchRows
        rows={bots.map((bot) => {
          const name = botName(bot, tDir);
          return {
            primary: [name],
            secondary: [botOwnerLabel(bot, tDir)],
            content: (
              <BotRow
                key={bot.id}
                bot={bot}
                name={name}
                muted
                meta={
                  <>
                    <Owner bot={bot} t={tDir} />
                    {bot.archivedAt ? (
                      <span>
                        {t("archivedOn", {
                          date: format.dateTime(bot.archivedAt, {
                            month: "short",
                            day: "numeric",
                          }),
                        })}
                      </span>
                    ) : null}
                  </>
                }
                actions={
                  bot.canRestore ? (
                    <ReactivateSharedBotButton botId={bot.id} name={name} />
                  ) : null
                }
              />
            ),
          };
        })}
      />
    </ul>
  );
}

/**
 * The bots the viewer configures, with Settings, Pause and Archive, and the
 * archived ones below with Restore. Shared by Soko Bots and a Project's Bots.
 */
export async function ManagedBotSections({
  title,
  note,
  action,
  bots,
  emptyText,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  bots: ManagedBot[];
  emptyText: string;
}) {
  const [t, tDir, format] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("App.Agents.Directory"),
    getFormatter(),
  ]);
  const live = bots.filter((bot) => bot.archivedAt === null);
  const archived = bots.filter((bot) => bot.archivedAt !== null);

  return (
    <>
      <AgentsSection
        id="soko-bots-manage"
        title={title}
        note={note}
        action={action}
      >
        {live.length > 0 ? (
          <LiveBotRows bots={live} t={t} tDir={tDir} />
        ) : (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            {emptyText}
          </p>
        )}
      </AgentsSection>
      {archived.length > 0 ? (
        <AgentsSection
          id="soko-bots-archived"
          title={t("archivedTitle")}
          note={t("Shared.Archived.description")}
        >
          <ArchivedBotRows bots={archived} t={t} tDir={tDir} format={format} />
        </AgentsSection>
      ) : null}
    </>
  );
}
