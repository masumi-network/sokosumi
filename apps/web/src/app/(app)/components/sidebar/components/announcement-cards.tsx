"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { isVideoUrl } from "@/app/components/notice-dialog";
import { useNoticeDialog } from "@/app/components/notice-dialog-context";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import type { Notice } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { parseNoticeTemplate } from "@/lib/utils/notice-template";

const MAX_VISIBLE_ANNOUNCEMENTS = 3;

export default function AnnouncementCards() {
  const t = useTranslations("App.NoticeDialog");
  const { openNotice, announcementNotices } = useNoticeDialog();
  const { state } = useSidebar();

  const cards = useMemo(() => {
    return announcementNotices
      .slice(0, MAX_VISIBLE_ANNOUNCEMENTS)
      .map((notice) => {
        const template = parseNoticeTemplate(notice.bodyMarkdown);
        return {
          notice,
          title: template.header.title,
          summary: template.header.summary,
          coverUrl: template.header.cover,
          bodyMarkdown: template.bodyMarkdown,
        };
      });
  }, [announcementNotices]);

  if (cards.length === 0 || state === "collapsed") {
    return null;
  }

  function handleOpenNotice(notice: Notice) {
    openNotice(notice);
  }

  function getStackStyle(index: number) {
    if (index === 0) {
      return undefined;
    }

    const offsetY = index === 1 ? 4 : 18;
    const scale = index === 1 ? 0.97 : 0.94;
    const rotateX = Math.min(4 + index * 2, 10);

    return {
      transform: `perspective(900px) translateY(-${offsetY}px) scale(${scale}) rotateX(${rotateX}deg)`,
      transformOrigin: "top center",
    } satisfies React.CSSProperties;
  }

  return (
    <div className="px-2 pb-2">
      <div className="relative pt-4">
        {cards.map((card, index) => {
          const cardZIndex = cards.length - index;
          const isBackCard = index > 0;
          const isPrimaryCard = index === 0;

          return (
            <article
              key={card.notice.id}
              className={cn(
                "border-sidebar-border bg-sidebar overflow-hidden rounded-lg border",
                index === 0
                  ? "relative"
                  : "absolute inset-x-0 top-0 h-full max-h-full",
                "shadow-xs",
                isPrimaryCard &&
                  "hover:bg-sidebar-accent focus-visible:ring-sidebar-ring cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-hidden",
                isBackCard && "pointer-events-none",
              )}
              style={{
                zIndex: cardZIndex,
                ...getStackStyle(index),
              }}
              role={isPrimaryCard ? "button" : undefined}
              tabIndex={isPrimaryCard ? 0 : undefined}
              onClick={
                isPrimaryCard ? () => handleOpenNotice(card.notice) : undefined
              }
              onKeyDown={
                isPrimaryCard
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenNotice(card.notice);
                      }
                    }
                  : undefined
              }
            >
              {card.coverUrl ? (
                <div className="bg-muted overflow-hidden">
                  {isVideoUrl(card.coverUrl) ? (
                    <video
                      src={card.coverUrl}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="aspect-16/7 w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.coverUrl}
                      alt={card.title}
                      className="aspect-16/7 w-full object-cover"
                    />
                  )}
                </div>
              ) : null}
              <div className="space-y-2 p-3">
                {card.title ? (
                  <p className="line-clamp-1 text-sm leading-tight font-medium">
                    {card.title}
                  </p>
                ) : null}
                {card.summary ? (
                  <p className="text-sidebar-foreground/70 line-clamp-2 text-xs leading-4">
                    {card.summary}
                  </p>
                ) : null}
                {!card.title && !card.summary ? (
                  <Markdown className="text-sidebar-foreground/80 line-clamp-3 text-xs leading-4 *:m-0 [&_p]:inline">
                    {card.bodyMarkdown}
                  </Markdown>
                ) : null}
                {isPrimaryCard ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleOpenNotice(card.notice);
                      }}
                    >
                      {t("actions.seeMore")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
