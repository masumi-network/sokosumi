"use client";

import { Bot, PencilLine, Plus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { useIsMobileMedia } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { seoAuditName } from "./seo-audit-name";
import type { SeoKeywordPoint } from "./seo-keyword-map-model";
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
}: {
  point: SeoKeywordPoint;
  model: SeoWorkspaceModel;
  onCloseAutoFocus: (event: Event) => void;
  onInteractOutside: () => void;
}) {
  const titleId = useId();
  // A phone has no room beside a dot: the popover stands under it.
  const phone = useIsMobileMedia();
  const t = useTranslations("App.Seo.keywords");
  const format = useFormatter();
  const locale = useLocale();
  const wizard = useOptionalNewTaskWizard();
  const { lead } = point.group;
  const band = seoDifficultyBand(point.difficulty) ?? "hard";
  // The keyword's own page names the site; an idea has none, so the first page in view does.
  const page =
    lead.pageUrl ??
    model.data.pages.find((item) => model.data.scope.pageIds.includes(item.id))
      ?.url;
  const brief = t("map.brief", {
    keyword: lead.keyword,
    volume: point.volume,
    market: seoMarketName(locale, lead.countryCode, lead.languageCode),
    difficulty: t(`difficulty.${band}`),
    value: Math.round(point.difficulty),
    site: page ? seoAuditName("", page) : "",
    feature: point.group.feature ?? "none",
  });
  const { canEdit } = model.data.availableActions;
  return (
    <PopoverContent
      side={phone ? "bottom" : "right"}
      align={phone ? "center" : "start"}
      collisionPadding={16}
      aria-labelledby={titleId}
      onCloseAutoFocus={onCloseAutoFocus}
      onInteractOutside={onInteractOutside}
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
          {point.gain ? `+${format.number(point.gain.top3)}` : t("map.noGain")}
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
            onClick={() =>
              wizard.openNewTaskWizard({
                prompt: brief,
                projectId: model.data.projectId ?? null,
              })
            }
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
            onClick={() => model.openChat(brief)}
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
              disabled={model.pending}
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
