"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { SokoBotBrief } from "@/lib/soko-bot/brief";

import {
  SOKO_BOT_SOURCE_ICONS,
  sokoBotSourceLabel,
} from "./soko-bot-message-footer";

/** Which check-ins render as a card: the bot's own rhythms and briefing. */
const BRIEF_SOURCES = new Set(["inbox", "standup", "weeklyWrap", "scheduled"]);

export function isSokoBotBriefSource(metadata: unknown): boolean {
  const label = sokoBotSourceLabel(metadata);
  return label !== null && BRIEF_SOURCES.has(label.kind);
}

/**
 * A stand-up, plan, wrap or briefing as a card: what it is and when, the
 * headline, short sections, the numbers, and the bot's housekeeping last.
 */
export function SokoBotBriefCard({
  brief,
  metadata,
  createdAt,
  renderMarkdown,
}: {
  brief: SokoBotBrief;
  metadata: unknown;
  createdAt: Date | string;
  renderMarkdown: (content: string) => ReactNode;
}) {
  const t = useTranslations("App.Chat.SokoBot.source");
  const format = useFormatter();
  const label = sokoBotSourceLabel(metadata);
  if (!label) return null;
  const Icon = SOKO_BOT_SOURCE_ICONS[label.kind];
  const title =
    label.kind === "scheduled" || label.kind === "background"
      ? label.name
      : label.kind === "inbox"
        ? t("briefing")
        : t(label.kind);
  return (
    <article
      data-testid="soko-bot-brief-card"
      className="bg-background w-full max-w-2xl rounded-lg border"
    >
      <header className="text-muted-foreground flex items-center gap-1.5 border-b px-4 py-2 text-xs">
        <Icon aria-hidden className="size-3.5" />
        <span className="text-foreground font-medium">{title}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(createdAt).toISOString()}>
          {format.dateTime(new Date(createdAt), {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </time>
      </header>
      <div className="space-y-4 p-4">
        <div className="text-foreground font-semibold tracking-tight [&_p]:text-base">
          {renderMarkdown(brief.headline)}
        </div>
        {brief.sections.map((section) => (
          <section key={section.title} className="space-y-1.5">
            <h4 className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
              {section.title}
            </h4>
            {renderMarkdown(section.body)}
          </section>
        ))}
        {brief.numbers.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {brief.numbers.map((item) => (
              <li
                key={item}
                className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs tabular-nums"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {brief.notes ? (
        <footer className="text-muted-foreground border-t px-4 py-2 text-xs [&_p]:text-xs [&_p]:text-muted-foreground">
          {renderMarkdown(brief.notes)}
        </footer>
      ) : null}
    </article>
  );
}
