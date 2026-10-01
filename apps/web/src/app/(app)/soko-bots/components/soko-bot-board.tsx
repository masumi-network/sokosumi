import type {
  SokoBotDailyStats,
  SokoBotStatus,
  SokoBotTeam,
} from "@sokosumi/core-client";
import {
  ArrowRight,
  Calendar,
  ListTodo,
  MessageSquare,
  User,
} from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import {
  BOARD_CARD_CLASS,
  BOARD_COLUMN_CLASS,
} from "@/app/tasks/components/board-classes";
import { ColumnHeader } from "@/app/tasks/components/column-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getToneStyle } from "@/components/ui/status-marker";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { BotFace } from "./bot-face";
import { ChatWithBotButton, ChatWithBotTile } from "./open-bot-chat.client";
import {
  SOKO_BOT_STATUS_MARKERS,
  SokoBotStatusChip,
} from "./soko-bot-status-chip";

type Member = SokoBotTeam["members"][number];
type Bot = NonNullable<Member["bot"]>;
type Translate = Awaited<ReturnType<typeof getTranslations<"App.SokoBots">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

const STATUS_ORDER: SokoBotStatus[] = ["RUNNING", "IDLE", "PAUSED", "ERROR"];
/** Running and Idle are always shown; Paused and Error only when they hold a bot. */
const ALWAYS_SHOWN = new Set<SokoBotStatus>(["RUNNING", "IDLE"]);
const NOT_SET_UP_DOT = getToneStyle({ hue: "dormant", weight: "outline" }).dot;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function PersonAvatar({ member }: { member: Member }) {
  return (
    <Avatar className="size-5 shrink-0">
      {member.image ? (
        <AvatarImage src={member.image} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="bg-muted text-muted-foreground text-[0.625rem] font-medium">
        {initials(member.name) || <User aria-hidden className="size-3" />}
      </AvatarFallback>
    </Avatar>
  );
}

/** The card's project line, here the person the bot works for. */
function OwnerLine({ member, t }: { member: Member; t: Translate }) {
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
      <PersonAvatar member={member} />
      <span className="truncate">{member.name}</span>
      {member.isYou ? <span className="shrink-0">· {t("you")}</span> : null}
    </span>
  );
}

function FooterStat({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1" title={label}>
      {icon}
      <span className="text-[0.625rem] tabular-nums">{children}</span>
      <span className="sr-only">{label}</span>
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
  if (!bot.lastActivityAt) {
    return <span className="text-[0.625rem]">{t("notActiveYet")}</span>;
  }
  const date = format.dateTime(bot.lastActivityAt, {
    month: "short",
    day: "numeric",
  });
  return (
    <FooterStat
      icon={<Calendar className="size-3" aria-hidden />}
      label={t("lastActive", { date })}
    >
      {date}
    </FooterStat>
  );
}

function CardTitle({
  bot,
  member,
  t,
}: {
  bot: Bot;
  member: Member;
  t: Translate;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BotFace bot={bot} ownerId={member.userId} className="size-6" />
      <span className="text-foreground truncate text-sm leading-snug font-medium">
        {bot.name?.trim() || t("assistantFallback")}
      </span>
    </span>
  );
}

function TeamBotCard({
  member,
  bot,
  statusLabel,
  t,
  format,
}: {
  member: Member;
  bot: Bot;
  statusLabel: string;
  t: Translate;
  format: Format;
}) {
  const name = bot.name?.trim() || t("assistantFallback");
  return (
    <li>
      <ChatWithBotTile
        sokoBotId={bot.id}
        label={t("messageBot", { name })}
        errorLabel={t("chatError")}
        className={cn(BOARD_CARD_CLASS, "flex w-full flex-col gap-2.5 p-3")}
      >
        <SokoBotStatusChip status={bot.status} label={statusLabel} />
        <CardTitle bot={bot} member={member} t={t} />
        <OwnerLine member={member} t={t} />
        <span className="border-border text-muted-foreground flex items-center justify-end gap-2 border-t pt-2">
          <LastActive bot={bot} t={t} format={format} />
        </span>
      </ChatWithBotTile>
    </li>
  );
}

/** Your own card: the same shell, marked, with the stats and the chat button. */
function YourBotCard({
  member,
  bot,
  stats,
  statusLabel,
  t,
  format,
}: {
  member: Member;
  bot: Bot;
  stats: SokoBotDailyStats | null;
  statusLabel: string;
  t: Translate;
  format: Format;
}) {
  return (
    <li>
      <article
        className={cn(
          BOARD_CARD_CLASS,
          "border-primary-tertiary flex flex-col gap-2.5 p-3",
        )}
      >
        <SokoBotStatusChip status={bot.status} label={statusLabel} />
        <CardTitle bot={bot} member={member} t={t} />
        <OwnerLine member={member} t={t} />
        <div>
          <ChatWithBotButton
            sokoBotId={bot.id}
            label={t("chat")}
            errorLabel={t("chatError")}
          />
        </div>
        <div className="border-border text-muted-foreground flex items-center justify-end gap-2 border-t pt-2">
          {stats ? (
            <>
              <FooterStat
                icon={<ListTodo className="size-3" aria-hidden />}
                label={t("statsTasks", {
                  count: stats.totals.tasks,
                  days: stats.days,
                })}
              >
                {stats.totals.tasks}
              </FooterStat>
              <FooterStat
                icon={<MessageSquare className="size-3" aria-hidden />}
                label={t("statsMessages", {
                  count: stats.totals.messages,
                  days: stats.days,
                })}
              >
                {stats.totals.messages}
              </FooterStat>
            </>
          ) : null}
          <LastActive bot={bot} t={t} format={format} />
        </div>
      </article>
    </li>
  );
}

function CreateYourBotCard({ t }: { t: Translate }) {
  return (
    <li>
      <article
        className={cn(
          BOARD_CARD_CLASS,
          "border-primary-tertiary flex flex-col gap-2.5 p-3",
        )}
      >
        <span className="text-foreground text-sm leading-snug font-medium">
          {t("noAssistantYou")}
        </span>
        <span className="text-muted-foreground text-xs">
          {t("createAssistantHint")}
        </span>
        <div>
          <Button asChild size="sm">
            <Link href={SOKO_BOT_ROUTE}>
              {t("createAssistant")}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
        </div>
      </article>
    </li>
  );
}

/** A teammate with no assistant: the board's quiet, compact row. */
function NotSetUpCard({ member, t }: { member: Member; t: Translate }) {
  return (
    <li className="bg-background border-border flex items-center rounded-lg border p-2">
      <OwnerLine member={member} t={t} />
    </li>
  );
}

function Column({
  title,
  count,
  dot,
  children,
}: {
  title: string;
  count: number;
  dot: string;
  children: ReactNode;
}) {
  return (
    <section className={BOARD_COLUMN_CLASS}>
      <div className="px-3 pt-3 pb-2">
        <ColumnHeader title={title} count={count} statusColorClass={dot} />
      </div>
      <ul className="flex flex-col gap-2 px-2 pb-2">{children}</ul>
    </section>
  );
}

/**
 * The team as the Task board draws work: one column per bot status, plus the
 * people who have not set one up. Your own card leads its column.
 */
export async function SokoBotBoard({
  team,
  stats,
}: {
  team: SokoBotTeam;
  stats: SokoBotDailyStats | null;
}) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("Components.SokoBot.BotStatus"),
    getFormatter(),
  ]);
  const members = [...team.members].sort(
    (a, b) => Number(b.isYou) - Number(a.isYou),
  );
  const withoutBot = members.filter((member) => !member.bot);
  const me = members.find((member) => member.isYou) ?? null;

  const columns = STATUS_ORDER.map((status) => ({
    status,
    members: members.filter((member) => member.bot?.status === status),
  })).filter(
    (column) => ALWAYS_SHOWN.has(column.status) || column.members.length > 0,
  );

  return (
    <div className="-mx-4 flex items-start gap-3 overflow-x-auto px-4 pb-2">
      {columns.map((column) => (
        <Column
          key={column.status}
          title={tStatus(column.status)}
          count={column.members.length}
          dot={getToneStyle(SOKO_BOT_STATUS_MARKERS[column.status].tone).dot}
        >
          {column.members.map((member) => {
            const bot = member.bot;
            if (!bot) return null;
            return member.isYou ? (
              <YourBotCard
                key={member.userId}
                member={member}
                bot={bot}
                stats={stats}
                statusLabel={tStatus(bot.status)}
                t={t}
                format={format}
              />
            ) : (
              <TeamBotCard
                key={member.userId}
                member={member}
                bot={bot}
                statusLabel={tStatus(bot.status)}
                t={t}
                format={format}
              />
            );
          })}
        </Column>
      ))}
      <Column
        title={t("notSetUp")}
        count={withoutBot.length}
        dot={NOT_SET_UP_DOT}
      >
        {me && !me.bot ? <CreateYourBotCard t={t} /> : null}
        {withoutBot
          .filter((member) => !member.isYou)
          .map((member) => (
            <NotSetUpCard key={member.userId} member={member} t={t} />
          ))}
      </Column>
    </div>
  );
}
