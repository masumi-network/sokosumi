import type { SokoBotTeam } from "@sokosumi/core-client";
import { Plus, Settings, User } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuroraOrb } from "@/components/aurora-orb";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { MessageBotButton } from "./message-bot-button.client";
import { TeamCarouselFrame } from "./team-carousel-frame.client";

type Member = SokoBotTeam["members"][number];
type Translate = Awaited<ReturnType<typeof getTranslations<"App.SokoBots">>>;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function AgentPanel({ member, t }: { member: Member; t: Translate }) {
  const bot = member.bot;
  if (!bot) {
    if (!member.isYou) {
      return (
        <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-8 text-xs">
          {t("noAssistant")}
        </div>
      );
    }
    return (
      <Link
        href={SOKO_BOT_ROUTE}
        className="border-primary-tertiary press hover:border-primary hover:bg-primary-quinary flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-6 text-center text-sm transition-colors"
      >
        <span className="bg-primary-quinary text-primary inline-flex size-10 items-center justify-center rounded-full">
          <Plus aria-hidden className="size-4" />
        </span>
        <span className="font-medium">{t("createAssistant")}</span>
        <span className="text-muted-foreground text-xs">
          {t("createAssistantHint")}
        </span>
      </Link>
    );
  }
  const name = bot.name?.trim() || t("assistantFallback");
  return (
    <div className="bg-muted/40 flex flex-1 flex-col items-center gap-3 rounded-lg px-3 py-5 text-center">
      {bot.avatarImageUrl ? (
        <img
          src={bot.avatarImageUrl}
          alt=""
          className="size-16 rounded-full object-cover"
        />
      ) : (
        <AuroraOrb
          seed={bot.avatarSeed ?? defaultOrbSeed(member.userId)}
          size={128}
          alt=""
          className="size-16"
        />
      )}
      <div className="flex min-w-0 max-w-full flex-col items-center gap-1.5">
        <span className="max-w-full truncate text-sm font-medium">{name}</span>
        <SokoBotStatusBadge status={bot.status} />
      </div>
      <div className="mt-auto flex w-full flex-col gap-1.5">
        <MessageBotButton
          sokoBotId={bot.id}
          label={t("message")}
          errorLabel={t("chatError")}
          variant="button"
        />
        {member.isYou ? (
          <Link
            href={SOKO_BOT_ROUTE}
            className="text-muted-foreground hover:text-foreground press inline-flex items-center justify-center gap-1.5 py-1 text-xs"
          >
            <Settings aria-hidden className="size-3" />
            {t("manage")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function MemberCard({ member, t }: { member: Member; t: Translate }) {
  return (
    <li className="w-60 shrink-0 snap-start">
      <article
        className={cn(
          "bg-card-background flex h-full flex-col gap-4 rounded-xl border p-4",
          member.isYou && "border-primary-tertiary",
        )}
      >
        <div className="flex items-center gap-3">
          <Avatar className="size-10 shrink-0">
            {member.image ? (
              <AvatarImage
                src={member.image}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : null}
            <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
              {initials(member.name) || <User aria-hidden className="size-4" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {member.name}
              {member.isYou ? (
                <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                  {t("you")}
                </span>
              ) : null}
            </p>
            {member.role ? (
              <p className="text-muted-foreground truncate text-xs capitalize">
                {member.role}
              </p>
            ) : null}
          </div>
        </div>
        <AgentPanel member={member} t={t} />
      </article>
    </li>
  );
}

/** The team as a row of people, each with their Soko Bot below them. */
export async function TeamCarousel({ team }: { team: SokoBotTeam }) {
  const t = await getTranslations("App.SokoBots");
  const members = [...team.members].sort(
    (a, b) => Number(b.isYou) - Number(a.isYou),
  );
  return (
    <TeamCarouselFrame
      label={t("teamTitle")}
      previousLabel={t("previous")}
      nextLabel={t("next")}
    >
      {members.map((member) => (
        <MemberCard key={member.userId} member={member} t={t} />
      ))}
    </TeamCarouselFrame>
  );
}
