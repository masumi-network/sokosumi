"use client";

import { Bot, PencilLine, Plus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useRef } from "react";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { useIsMobileMedia } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  type SeoKeywordPoint,
  seoKeywordBriefSite,
} from "./seo-keyword-map-model";
import { seoDifficultyBand } from "./seo-keyword-rows-model";
import { seoMarketName } from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The tint of a difficulty word: easy is the one to go for. */
const BAND_TEXT = {
  easy: "text-chart-2",
  medium: "text-foreground",
  hard: "text-muted-foreground",
} as const;

/**
 * A keyword of the map, opened by a press on its dot: its numbers, and what to do with it. A content Task opens
 * the New Task wizard with a brief for the keyword, so the reader picks who writes it before anything is made.
 */
export function SeoKeywordMapPopover({
  point,
  model,
  onCloseAutoFocus,
  onInteractOutside,
  onLeave,
}: {
  point: SeoKeywordPoint;
  model: SeoWorkspaceModel;
  onCloseAutoFocus: (event: Event) => void;
  onInteractOutside: () => void;
  /** Closes the popover before an action opens another dialog. */
  onLeave: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // A phone has no room beside a dot: the popover stands under it.
  const phone = useIsMobileMedia();
  const t = useTranslations("App.Seo.keywords");
  const format = useFormatter();
  const locale = useLocale();
  const wizard = useOptionalNewTaskWizard();
  const { lead } = point.group;
  const band = seoDifficultyBand(point.difficulty) ?? "hard";
  const facts = {
    keyword: lead.keyword,
    volume: point.volume,
    market: seoMarketName(locale, lead.countryCode, lead.languageCode),
    // Inside a sentence the band is a plain word.
    difficulty: t(`difficulty.${band}`).toLocaleLowerCase(locale),
    value: Math.round(point.difficulty),
    site: seoKeywordBriefSite(lead.pageUrl, model.data),
    feature: point.group.feature ?? "none",
  };
  // The Task gets the order to write; the agent gets a question, so it advises before it writes.
  const brief = t("map.brief", facts);
  const { canEdit } = model.data.availableActions;
  return (
    <PopoverContent
      side={phone ? "bottom" : "right"}
      align={phone ? "center" : "start"}
      collisionPadding={16}
      aria-labelledby={titleId}
      ref={content}
      // The popover itself takes the focus, so a screen reader starts on its name and a held Enter presses
      // no button.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        content.current?.focus();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      onInteractOutside={onInteractOutside}
      // The popover stands at the end of the page: a Tab out of it closes it and goes back to the map, not to
      // the browser bar.
      onKeyDown={(event) => {
        const box = content.current;
        if (event.key !== "Tab" || !box) return;
        const items = box.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href]",
        );
        const edge = event.shiftKey
          ? [box, items[0]]
          : [items[items.length - 1] ?? box];
        if (!edge.includes(document.activeElement as HTMLElement)) return;
        event.preventDefault();
        onLeave();
      }}
      className="w-[min(18rem,calc(100vw-2rem))] space-y-3 p-4 text-sm"
      data-testid="seo-keyword-popover"
    >
      <div className="flex items-start gap-2">
        <h4 id={titleId} className="min-w-0 flex-1 font-semibold break-words">
          <bdi>{lead.keyword}</bdi>
        </h4>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
          {point.checked ? t("map.yours") : t("map.idea")}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-1.5">
        <Figure label={t("volume")}>{format.number(point.volume)}</Figure>
        <Figure label={t("difficulty.title")}>
          <span className={cn("font-semibold", BAND_TEXT[band])}>
            {t(`difficulty.${band}`)}
          </span>
        </Figure>
        <Figure label={t("map.gainShort")}>
          {/* A keyword already in the top 3 gains nothing: 0, not +0. */}
          {point.gain
            ? `${point.gain.top3 > 0 ? "+" : ""}${format.number(point.gain.top3)}`
            : t("map.noGain")}
        </Figure>
      </dl>
      {point.group.feature ? (
        <p className="text-muted-foreground text-xs break-words">
          {t.rich("conversion.feature", {
            feature: () => point.group.feature,
          })}
        </p>
      ) : null}
      <div className="grid gap-2">
        {wizard ? (
          <Button
            size="sm"
            onClick={() => {
              onLeave();
              wizard.openNewTaskWizard({
                prompt: brief,
                projectId: model.data.projectId ?? null,
              });
            }}
          >
            <PencilLine />
            {t("map.contentTask")}
          </Button>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => {
              onLeave();
              model.openChat(t("map.question", facts));
            }}
          >
            <Bot />
            {t("map.ask")}
          </Button>
          {/* Only an idea can be tracked: the keywords of a check are tracked from the start. */}
          {!point.checked && canEdit ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              // Busy, not disabled: Track keeps the focus while it saves, so the keys go on from it.
              loading={model.pending}
              onClick={() => {
                void model.toggleKeyword(lead);
              }}
            >
              <Plus />
              {t("save")}
            </Button>
          ) : null}
        </div>
      </div>
    </PopoverContent>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-muted min-w-0 rounded-md px-2 py-1.5">
      <dt className="text-muted-foreground truncate text-xs">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
