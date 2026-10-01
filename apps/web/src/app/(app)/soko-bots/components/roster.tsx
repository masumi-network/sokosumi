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

import { BOARD_CARD_CLASS } from "@/app/tasks/components/board-classes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

/** One muted icon-and-value, as in the task card footer. */
function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

function shortDate(format: Format, date: Date) {
  return format.dateTime(date, { month: "short", day: "numeric" });
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
  return (
    <Stat icon={<Calendar aria-hidden className="size-3" />}>
      {t("lastActive", { date: shortDate(format, bot.lastActivityAt) })}
    </Stat>
  );
}

function botName(bot: Bot, t: Translate) {
  return bot.name?.trim() || t("assistantFallback");
}

/** The viewer's own assistant: the one card on the page with the accent. */
export async function YourAssistantCard({
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
  const shell =
    "bg-background border-primary-tertiary flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center";

  if (!bot || !me) {
    return (
      <section className={shell}>
        <span className="bg-primary-quinary text-primary inline-flex size-12 shrink-0 items-center justify-center rounded-full">
          <Plus aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-foreground text-sm font-medium">
            {t("noAssistantYou")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("createAssistantHint")}
          </p>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link href={SOKO_BOT_ROUTE}>
            {t("createAssistant")}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <section className={shell} aria-label={botName(bot, t)}>
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
        <BotFace bot={bot} ownerId={me.userId} className="size-12" />
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {botName(bot, t)}
            </span>
            <SokoBotStatusChip
              status={bot.status}
              label={tStatus(bot.status)}
              size="sm"
            />
          </div>
          <p className="text-muted-foreground text-xs">{t("roleLine")}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {stats ? (
              <>
                <Stat icon={<ListTodo aria-hidden className="size-3" />}>
                  {t("statsTasks", {
                    count: stats.totals.tasks,
                    days: stats.days,
                  })}
                </Stat>
                <Stat icon={<MessageSquare aria-hidden className="size-3" />}>
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
      <div className="flex shrink-0 items-center gap-2 pl-16 sm:pl-0">
        <ChatWithBotButton
          sokoBotId={bot.id}
          label={t("chat")}
          errorLabel={t("chatError")}
        />
        <Button asChild size="sm" variant="ghost">
          <Link href={SOKO_BOT_ROUTE}>
            <Settings aria-hidden className="size-3.5" />
            {t("manage")}
          </Link>
        </Button>
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
          BOARD_CARD_CLASS,
          "hover:border-border hover:bg-card-background-hover group flex w-full flex-col gap-3 p-4 hover:shadow-none",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <BotFace bot={bot} ownerId={member.userId} className="size-8" />
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {name}
          </span>
          <SokoBotStatusChip
            status={bot.status}
            label={tStatus(bot.status)}
            size="sm"
          />
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0">{t("assistantOf")}</span>
          <PersonAvatar member={member} />
          <span className="truncate">{member.name}</span>
        </span>
        <span className="border-border text-muted-foreground flex items-center justify-between gap-2 border-t pt-2 text-xs">
          <LastActive bot={bot} t={t} format={format} />
          <span
            aria-hidden
            className="text-foreground flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t("message")}
            <ArrowRight className="size-3" />
          </span>
        </span>
      </ChatWithBotTile>
    </li>
  );
}

/** People without an assistant: one quiet line, names on hover. */
function NotSetUpLine({ members, t }: { members: Member[]; t: Translate }) {
  if (members.length === 0) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span>{t("notSetUp")}</span>
      <ul className="flex -space-x-1">
        {members.slice(0, STACK_SHOWN).map((member) => (
          <li key={member.userId}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ring-background block rounded-full ring-2">
                  <PersonAvatar member={member} className="size-6" />
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

/** Everyone else's assistant, as a grid of person-and-bot pairs. */
export async function TeamRoster({ team }: { team: SokoBotTeam }) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("Components.SokoBot.BotStatus"),
    getFormatter(),
  ]);
  const others = team.members.filter((member) => !member.isYou);
  const paired = others.filter((member) => member.bot).sort(byLiveliness);
  const unpaired = others.filter((member) => !member.bot);

  return (
    <div className="space-y-4">
      {paired.length > 0 ? (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
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
      ) : team.workspace.kind === "personal" ? (
        <p className="text-muted-foreground text-sm">
          {t("teamDescriptionPersonal")}
        </p>
      ) : null}
      <NotSetUpLine members={unpaired} t={t} />
    </div>
  );
}
