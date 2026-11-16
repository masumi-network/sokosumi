"use client";

import { parseNoticeTemplate } from "@sokosumi/utils";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { NoticeCover } from "@/app/components/notice-dialog";
import { useNoticeDialog } from "@/app/components/notice-dialog-context";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * The oldest unread announcement, floating over the end of the sidebar list
 * and anchored on the footer's top edge: the list fades out beneath it and the
 * card casts a shadow, so it reads as on top. Open it, or close it with the x.
 */
export default function AnnouncementCards() {
  const t = useTranslations("App.NoticeDialog");
  const { openNotice, dismissNotice, announcementNotices } = useNoticeDialog();
  const { state } = useSidebar();
  const notice = announcementNotices[0];

  if (!notice || state === "collapsed") {
    return null;
  }

  const { header } = parseNoticeTemplate(notice.bodyMarkdown);
  const title = header.title ?? t("defaultTitle");

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 pointer-events-none absolute inset-x-0 bottom-full z-10 duration-200 ease-out motion-reduce:animate-none">
      <div className="to-sidebar from-transparent h-6 bg-linear-to-b" />
      <div className="bg-sidebar px-2 pb-2">
        <article className="bg-background press pointer-events-auto relative overflow-hidden rounded-lg border shadow-lg">
          {header.cover ? <NoticeCover url={header.cover} alt={title} /> : null}
          <div className="p-3">
            <button
              type="button"
              onClick={() => openNotice(notice)}
              className="block pr-6 text-left text-base leading-tight font-bold tracking-[-0.02em] outline-hidden after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-current"
            >
              {title}
            </button>
            {header.summary ? (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-4">
                {header.summary}
              </p>
            ) : null}
            <span className="mt-3 flex">
              <span className="bg-primary text-primary-foreground inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold">
                {t("actions.seeMore")}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => dismissNotice(notice)}
            aria-label={t("actions.close")}
            className="press hit-area bg-background absolute top-1.5 right-1.5 z-10 flex size-7 items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-hidden"
          >
            <X className="size-4" />
          </button>
        </article>
      </div>
    </div>
  );
}
