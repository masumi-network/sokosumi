import type { SokoBotDailyStats, SokoBotTeam } from "@sokosumi/core-client";
import {
  ArrowRight,
  Calendar,
  ListTodo,
  MessageSquare,
  Plus,
  Settings,
  User,
} from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  GALLERY_DIVIDER_CLASS,
  GALLERY_HERO_BAND_CLASS,
  GALLERY_HERO_HEADLINE_CLASS,
  GALLERY_HERO_INNER_CLASS,
  GALLERY_SECTION_HEADLINE_CLASS,
  GALLERY_SOCIAL_PROOF_CAPTION_CLASS,
  GALLERY_SOCIAL_PROOF_FACE_CLASS,
} from "@/components/agents/gallery-page-classes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { BotFace } from "./bot-face";
import { ChatWithBotButton, ChatWithBotTile } from "./open-bot-chat.client";
import { SokoBotStatusChip } from "./soko-bot-status-chip";

type Member = SokoBotTeam["members"][number];
type Bot = NonNullable<Member["bot"]>;
type Translate = Awaited<ReturnType<typeof getTranslations<"App.SokoBots">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

const HERO_FACES = 5;
const STACK_SHOWN = 8;

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
    <Avatar className={cn("size-5 shrink-0", className)}>
      {member.image ? (
        <AvatarImage src={member.image} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="bg-muted text-muted-foreground text-[0.625rem] font-medium">
        {initials(member.name) || <User aria-hidden className="size-3" />}
      </AvatarFallback>
    </Avatar>
  );
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

function LastActive({
  bot,
  t,
  format,
}: {
  bot: Bot;
  t: Translate;
  format: Format;
}) {
  if (!bot.lastActivityAt) return <span>{t("notActiveYet")}</span>;
  const date = format.dateTime(bot.lastActivityAt, {
    month: "short",
    day: "numeric",
  });
  return (
    <Stat icon={<Calendar aria-hidden className="size-3.5" />}>
      {t("lastActive", { date })}
    </Stat>
  );
}

function botName(bot: Bot, t: Translate) {
  return bot.name?.trim() || t("assistantFallback");
}

/** What a Soko Bot is, in the Agents hero's layout, and the one next step. */
export async function SokoBotsHero({ team }: { team: SokoBotTeam | null }) {
  const t = await getTranslations("App.SokoBots");
  const members = team?.members ?? [];
  const me = members.find((member) => member.isYou) ?? null;
  const faces = members
    .filter((member) => member.bot?.avatarImageUrl)
    .sort((a, b) => Number(b.isYou) - Number(a.isYou))
    .slice(0, HERO_FACES);

  return (
    <div className={GALLERY_HERO_BAND_CLASS}>
      <div className={GALLERY_HERO_INNER_CLASS}>
        {faces.length > 0 ? (
          <div className="flex items-center gap-2.5">
            <div className="flex -space-x-2">
              {faces.map((member) =>
                member.bot ? (
                  <BotFace
                    key={member.userId}
                    bot={member.bot}
                    ownerId={member.userId}
                    className={cn(
                      GALLERY_SOCIAL_PROOF_FACE_CLASS,
                      "ring-background ring-2",
                    )}
                  />
                ) : null,
              )}
            </div>
            <span className={GALLERY_SOCIAL_PROOF_CAPTION_CLASS}>
              {t("heroCaption")}
            </span>
          </div>
        ) : null}
        <h1 className={GALLERY_HERO_HEADLINE_CLASS}>{t("heroTitle")}</h1>
        <p className="text-muted-foreground max-w-xl text-sm text-pretty md:text-base">
          {t("heroBody")}
        </p>
        {me?.bot ? (
          <ChatWithBotButton
            sokoBotId={me.bot.id}
            label={t("chatWith", { name: botName(me.bot, t) })}
            errorLabel={t("chatError")}
          />
        ) : (
          <Button asChild>
            <Link href={SOKO_BOT_ROUTE}>
              {t("createAssistant")}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** A section headline with a muted note beside it, ruled off like Agents. */
function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={GALLERY_SECTION_HEADLINE_CLASS}>{title}</h2>
        {note ? (
          <span className="text-muted-foreground text-sm tabular-nums">
            {note}
          </span>
        ) : null}
      </div>
      <div aria-hidden className={GALLERY_DIVIDER_CLASS} />
    </div>
  );
}

/** The viewer's own assistant: the one card on the page with the accent. */
export async function YourAssistantSection({
  me,
  stats,
}: {
  me: Member | null;
  stats: SokoBotDailyStats | null;
}) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("Components.SokoBot.BotStatus"),
    getFormatter(),
  ]);
  const bot = me?.bot ?? null;
  const shell = cn(
    HOLDER_ITEM_CLASS,
    "border-primary-tertiary flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5",
  );

  return (
    <section className="space-y-6">
      <SectionHeader title={t("yourAssistantTitle")} />
      <div className={HOLDER_CLASS}>
        {!bot || !me ? (
          <div className={shell}>
            <span className="bg-primary-quinary text-primary inline-flex size-14 shrink-0 items-center justify-center rounded-full sm:size-16">
              <Plus aria-hidden className="size-6" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground text-lg font-medium">
                {t("noAssistantYou")}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("createAssistantHint")}
              </p>
            </div>
            {/* The hero carries the primary "Create"; this one stays secondary. */}
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={SOKO_BOT_ROUTE}>
                {t("createAssistant")}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className={shell}>
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <BotFace
                bot={bot}
                ownerId={me.userId}
                className="size-14 sm:size-16"
              />
              <div className="min-w-0 space-y-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="text-foreground truncate text-lg font-medium">
                    {botName(bot, t)}
                  </h3>
                  <SokoBotStatusChip
                    status={bot.status}
                    label={tStatus(bot.status)}
                    size="sm"
                  />
                </div>
                <p className="text-muted-foreground text-sm">{t("roleLine")}</p>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {stats ? (
                    <>
                      <Stat
                        icon={<ListTodo aria-hidden className="size-3.5" />}
                      >
                        {t("statsTasks", {
                          count: stats.totals.tasks,
                          days: stats.days,
                        })}
                      </Stat>
                      <Stat
                        icon={
                          <MessageSquare aria-hidden className="size-3.5" />
                        }
                      >
                        {t("statsMessages", {
                          count: stats.totals.messages,
                          days: stats.days,
                        })}
                      </Stat>
                    </>
                  ) : null}
                  <LastActive bot={bot} t={t} format={format} />
                </div>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={SOKO_BOT_ROUTE}>
                  <Settings aria-hidden className="size-4" />
                  {t("manage")}
                </Link>
              </Button>
              <ChatWithBotButton
                sokoBotId={bot.id}
                label={t("chat")}
                errorLabel={t("chatError")}
                className="w-full sm:w-auto"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Running first, then the most recently active, then the never active. */
function byLiveliness(a: Member, b: Member): number {
  const running = (m: Member) => Number(m.bot?.status === "RUNNING");
  const last = (m: Member) => m.bot?.lastActivityAt?.getTime() ?? -1;
  return running(b) - running(a) || last(b) - last(a);
}

function PairCard({
  member,
  bot,
  t,
  tStatus,
  format,
}: {
  member: Member;
  bot: Bot;
  t: Translate;
  tStatus: (key: Bot["status"]) => string;
  format: Format;
}) {
  const name = botName(bot, t);
  return (
    <li className={cn(!bot.lastActivityAt && "opacity-70")}>
      <ChatWithBotTile
        sokoBotId={bot.id}
        label={t("messageBot", { name })}
        errorLabel={t("chatError")}
        className={cn(
          HOLDER_ITEM_CLASS,
          HOLDER_ITEM_HOVER_CLASS,
          "group flex size-full flex-col gap-3 p-3 transition-colors",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <BotFace bot={bot} ownerId={member.userId} className="size-10" />
          <span className="text-foreground min-w-0 flex-1 truncate font-medium">
            {name}
          </span>
          <SokoBotStatusChip
            status={bot.status}
            label={tStatus(bot.status)}
            size="sm"
          />
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0">{t("assistantOf")}</span>
          <PersonAvatar member={member} />
          <span className="truncate">{member.name}</span>
        </span>
        <span className="border-border text-muted-foreground mt-auto flex items-center justify-between gap-2 border-t pt-2.5 text-xs">
          <LastActive bot={bot} t={t} format={format} />
          <span
            aria-hidden
            className="text-foreground flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t("message")}
            <ArrowRight className="size-3.5" />
          </span>
        </span>
      </ChatWithBotTile>
    </li>
  );
}

function NotSetUpLine({ members, t }: { members: Member[]; t: Translate }) {
  if (members.length === 0) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-3 px-2 py-1 text-sm">
      <span>{t("notSetUp")}</span>
      <ul className="flex -space-x-1">
        {members.slice(0, STACK_SHOWN).map((member) => (
          <li key={member.userId}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ring-background block rounded-full ring-2">
                  <PersonAvatar member={member} className="size-7" />
                  <span className="sr-only">{member.name}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{member.name}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
      {members.length > STACK_SHOWN ? (
        <span className="tabular-nums">+{members.length - STACK_SHOWN}</span>
      ) : null}
    </div>
  );
}

/** Everyone else's assistant, paired with the person it works for. */
export async function TeamSection({ team }: { team: SokoBotTeam }) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("Components.SokoBot.BotStatus"),
    getFormatter(),
  ]);
  const others = team.members.filter((member) => !member.isYou);
  const paired = others.filter((member) => member.bot).sort(byLiveliness);
  const unpaired = others.filter((member) => !member.bot);
  const isPersonal = team.workspace.kind === "personal";

  return (
    <section className="space-y-6">
      <SectionHeader
        title={t("teamTitle")}
        note={
          team.workspace.kind === "organization"
            ? t("teamSummary", { bots: paired.length, people: others.length })
            : undefined
        }
      />
      {paired.length > 0 || unpaired.length > 0 || isPersonal ? (
        <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
          {paired.length > 0 ? (
            <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
              {paired.map((member) =>
                member.bot ? (
                  <PairCard
                    key={member.userId}
                    member={member}
                    bot={member.bot}
                    t={t}
                    tStatus={tStatus}
                    format={format}
                  />
                ) : null,
              )}
            </ul>
          ) : isPersonal ? (
            <p className="text-muted-foreground px-2 py-1 text-sm">
              {t("teamDescriptionPersonal")}
            </p>
          ) : null}
          <NotSetUpLine members={unpaired} t={t} />
        </div>
      ) : null}
    </section>
  );
}
