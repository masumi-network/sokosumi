import { Building2, ChevronRight, Plus, User } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuroraOrb } from "@/components/aurora-orb";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import type { SokoBotTeam } from "@/lib/clients/generated/core";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { MessageBotButton } from "./message-bot-button.client";

type Member = SokoBotTeam["members"][number];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** A vertical connector between a person and what hangs below them. */
function Stem() {
  return <div aria-hidden className="bg-border mx-auto h-5 w-px" />;
}

async function BotNode({ member }: { member: Member }) {
  const t = await getTranslations("App.SokoBots");
  const bot = member.bot;
  if (!bot) {
    if (!member.isYou) {
      return (
        <div className="text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
          {t("noAssistant")}
        </div>
      );
    }
    return (
      <Link
        href={SOKO_BOT_ROUTE}
        className="border-primary/40 hover:border-primary hover:bg-primary/5 flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-sm transition-colors"
      >
        <span className="bg-primary/10 text-primary inline-flex size-9 shrink-0 items-center justify-center rounded-full">
          <Plus aria-hidden className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block font-medium">{t("createAssistant")}</span>
          <span className="text-muted-foreground block text-xs">
            {t("createAssistantHint")}
          </span>
        </span>
      </Link>
    );
  }
  const name = bot.name?.trim() || t("assistantFallback");
  const body = (
    <>
      {bot.avatarImageUrl ? (
        <img
          src={bot.avatarImageUrl}
          alt=""
          className="ring-border/40 size-9 shrink-0 rounded-full object-cover ring-1"
        />
      ) : (
        <AuroraOrb
          seed={bot.avatarSeed ?? defaultOrbSeed(member.userId)}
          size={72}
          alt=""
          className="ring-border/40 size-9 shrink-0 ring-1"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          <SokoBotStatusBadge status={bot.status} />
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {member.isYou
            ? t("yourAssistant")
            : t("assistantOf", {
                name: member.name.split(" ")[0] ?? member.name,
              })}
        </span>
      </span>
    </>
  );
  return (
    <div className="bg-card-background rounded-lg border">
      {member.isYou ? (
        <Link
          href={SOKO_BOT_ROUTE}
          className="hover:bg-muted/40 group flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors"
        >
          {body}
          <ChevronRight
            aria-hidden
            className="text-muted-foreground group-hover:text-foreground size-4 shrink-0"
          />
        </Link>
      ) : (
        <div className="flex items-center gap-3 px-3 py-3 text-sm">{body}</div>
      )}
      {bot.coworkerId ? (
        <div className="border-t px-3 py-1.5">
          <MessageBotButton
            coworkerId={bot.coworkerId}
            label={member.isYou ? t("openChat") : t("messageAssistant")}
            errorLabel={t("chatError")}
          />
        </div>
      ) : null}
    </div>
  );
}

async function PersonNode({ member }: { member: Member }) {
  const t = await getTranslations("App.SokoBots");
  return (
    <li className="flex w-full flex-col">
      <div
        className={cn(
          "bg-card-background flex items-center gap-3 rounded-lg border px-3 py-3 text-sm",
          member.isYou && "border-primary/50",
        )}
      >
        <Avatar className="size-9 shrink-0">
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
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {member.name}
            {member.isYou ? (
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                {t("you")}
              </span>
            ) : null}
          </span>
          {member.role ? (
            <span className="text-muted-foreground block text-xs capitalize">
              {member.role}
            </span>
          ) : null}
        </span>
      </div>
      <Stem />
      <BotNode member={member} />
    </li>
  );
}

/** Workspace on top, people below, each person's Soko Bots under them. */
export async function TeamChart({ team }: { team: SokoBotTeam }) {
  const t = await getTranslations("App.SokoBots");
  const members = [...team.members].sort(
    (a, b) => Number(b.isYou) - Number(a.isYou),
  );
  return (
    <div className="space-y-0">
      <div className="bg-card-background inline-flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
        {team.workspace.logo ? (
          <img
            src={team.workspace.logo}
            alt=""
            className="ring-border/40 size-9 shrink-0 rounded-full object-cover ring-1"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="bg-muted text-muted-foreground inline-flex size-9 items-center justify-center rounded-full">
            {team.workspace.kind === "organization" ? (
              <Building2 aria-hidden className="size-4" />
            ) : (
              <User aria-hidden className="size-4" />
            )}
          </span>
        )}
        <span>
          <span className="block font-medium">{team.workspace.name}</span>
          <span className="text-muted-foreground block text-xs">
            {team.workspace.kind === "organization"
              ? t("peopleCount", { count: members.length })
              : t("personalWorkspace")}
          </span>
        </span>
      </div>
      <div aria-hidden className="bg-border ml-8 h-6 w-px" />
      <ul className="grid grid-cols-1 items-start gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {members.map((member) => (
          <PersonNode key={member.userId} member={member} />
        ))}
      </ul>
    </div>
  );
}
