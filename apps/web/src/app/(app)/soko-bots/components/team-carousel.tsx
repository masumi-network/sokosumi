import type { SokoBotTeam } from "@sokosumi/core-client";
import { User } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { SokoBotStatusLine } from "@/components/soko-bot/soko-bot-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { BotFace } from "./bot-face";
import { ChatWithBotTile } from "./open-bot-chat.client";
import { TeamCarouselFrame } from "./team-carousel-frame.client";

type Member = SokoBotTeam["members"][number];

const NOT_SET_UP_SHOWN = 12;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function PersonAvatar({
  member,
  className,
}: {
  member: Member;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {member.image ? (
        <AvatarImage src={member.image} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
        {initials(member.name) || <User aria-hidden className="size-3.5" />}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The team, one tile per person with the assistant they built below them.
 * The viewer's own assistant is on the page above, so it is not repeated.
 */
export async function TeamCarousel({ team }: { team: SokoBotTeam }) {
  const t = await getTranslations("App.SokoBots");
  const others = team.members.filter((member) => !member.isYou);
  const withBot = others.filter((member) => member.bot);
  const withoutBot = others.filter((member) => !member.bot);

  const header = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-foreground text-base font-semibold tracking-tight">
        {t("teamTitle")}
      </h2>
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("teamSummary", {
          bots: withBot.length,
          people: others.length,
        })}
      </p>
    </div>
  );

  return (
    <section className="space-y-4">
      {withBot.length > 0 ? (
        <TeamCarouselFrame
          header={header}
          label={t("teamTitle")}
          previousLabel={t("previous")}
          nextLabel={t("next")}
        >
          {withBot.map((member) => {
            const bot = member.bot;
            if (!bot) return null;
            const botName = bot.name?.trim() || t("assistantFallback");
            return (
              <li key={member.userId} className="w-48 shrink-0 snap-start">
                <ChatWithBotTile
                  sokoBotId={bot.id}
                  label={t("messageBot", { name: botName })}
                  errorLabel={t("chatError")}
                  className="bg-card-background hover:bg-card-background-hover flex size-full flex-col items-center rounded-xl border px-4 pt-5 pb-4 text-center transition-colors"
                >
                  <PersonAvatar member={member} className="size-9" />
                  <span className="text-foreground mt-2.5 max-w-full truncate text-sm font-medium">
                    {member.name}
                  </span>
                  <span
                    aria-hidden
                    className="bg-border my-3 h-5 w-px shrink-0"
                  />
                  <BotFace
                    bot={bot}
                    ownerId={member.userId}
                    className="size-14"
                  />
                  <span className="text-foreground mt-2.5 max-w-full truncate text-sm">
                    {botName}
                  </span>
                  <span className="mt-1">
                    <SokoBotStatusLine status={bot.status} />
                  </span>
                </ChatWithBotTile>
              </li>
            );
          })}
        </TeamCarouselFrame>
      ) : (
        <div className="space-y-2">
          {header}
          <p className="text-muted-foreground text-sm">
            {team.workspace.kind === "organization"
              ? t("noTeamBots")
              : t("teamDescriptionPersonal")}
          </p>
        </div>
      )}

      {withoutBot.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-xs">{t("notSetUp")}</span>
          <ul className="flex -space-x-2">
            {withoutBot.slice(0, NOT_SET_UP_SHOWN).map((member) => (
              <li key={member.userId} title={member.name}>
                <PersonAvatar
                  member={member}
                  className="ring-background size-7 ring-2"
                />
                <span className="sr-only">{member.name}</span>
              </li>
            ))}
          </ul>
          {withoutBot.length > NOT_SET_UP_SHOWN ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              +{withoutBot.length - NOT_SET_UP_SHOWN}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
