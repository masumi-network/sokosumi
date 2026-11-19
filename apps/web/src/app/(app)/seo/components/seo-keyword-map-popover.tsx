"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { useIsMobileMedia } from "@/hooks/use-mobile";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { SeoKeywordDraftDetails } from "./seo-keyword-draft-details";
import type { SeoKeywordPoint } from "./seo-keyword-map-model";
import { seoDifficultyBand } from "./seo-keyword-rows-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

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
  const result = useSeoResultTranslations("App.Seo.keywords");
  const { lead } = point.group;
  const band = seoDifficultyBand(point.difficulty) ?? "hard";
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
      className="max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-4 text-sm"
      data-testid="seo-keyword-popover"
    >
      <div lang="en" className="flex items-start gap-2">
        <h4 id={titleId} className="min-w-0 flex-1 font-semibold break-words">
          <bdi lang={lead.languageCode ?? ""}>{lead.keyword}</bdi>
        </h4>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
          {point.checked ? result("map.yours") : result("map.idea")}
        </span>
      </div>
      <p lang="en" className="text-muted-foreground text-xs tabular-nums">
        {result("map.preview", {
          volume: point.volume,
          value: Math.round(point.difficulty),
        })}{" "}
        · {result(`difficulty.${band}`)}
        {point.group.best !== null
          ? ` · ${result("ranked", { position: point.group.best })}`
          : point.checked && point.group.reads.length
            ? ` · ${result("notFound")}`
            : null}
      </p>
      <SeoKeywordDraftDetails
        group={point.group}
        model={model}
        idea={!point.checked}
        onLeave={onLeave}
        track={
          <>
            {/* Only an idea can be tracked: the keywords of a check are tracked from the start. */}
            {!point.checked && canEdit ? (
              <Button
                size="sm"
                variant="outline"
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
          </>
        }
      />
    </PopoverContent>
  );
}
