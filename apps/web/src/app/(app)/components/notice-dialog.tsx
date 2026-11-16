"use client";

import type { Notice } from "@sokosumi/core-client";
import { NoticeKind } from "@sokosumi/core-client";
import { parseNoticeTemplate } from "@sokosumi/utils";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeNoticeAction } from "@/lib/actions/notice/action";
import { cn } from "@/lib/utils";
import { isVideoUrl } from "@/lib/utils/file-preview";

const Markdown = dynamic(() => import("@/components/markdown"), {
  loading: () => (
    <div className="bg-muted h-24 w-full animate-pulse rounded" aria-hidden />
  ),
});

interface NoticeDialogProps {
  pendingNotices: Notice[];
  noticeToShow?: Notice | null;
  onNoticeClose?: () => void;
  onNoticeAcknowledged?: () => Promise<void>;
}

export function NoticeDialog({
  pendingNotices,
  noticeToShow = null,
  onNoticeClose,
  onNoticeAcknowledged,
}: NoticeDialogProps) {
  const t = useTranslations("App.NoticeDialog");
  const [isOpen, setIsOpen] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isExternalNotice = noticeToShow !== null;
  const currentNotice = noticeToShow ?? pendingNotices[0];
  const dialogOpen = isExternalNotice ? true : isOpen;
  const parsedTemplate = useMemo(() => {
    if (!currentNotice) {
      return null;
    }
    return parseNoticeTemplate(currentNotice.bodyMarkdown);
  }, [currentNotice]);

  if (!currentNotice || !parsedTemplate) {
    return null;
  }

  const noticeTitle = parsedTemplate.header.title ?? t("defaultTitle");
  const noticeSummary = parsedTemplate.header.summary;
  const coverUrl = parsedTemplate.header.cover;
  const actionLabel = parsedTemplate.header.actionLabel;
  const actionUrl = parsedTemplate.header.actionUrl;
  const isLegalNotice = currentNotice.kind === NoticeKind.LEGAL_TERMS;
  const isAnnouncementNotice = currentNotice.kind === NoticeKind.ANNOUNCEMENT;

  async function acknowledgeCurrentNotice(options?: {
    closeExternal?: boolean;
  }) {
    const closeExternal = options?.closeExternal ?? true;
    setIsSubmitting(true);
    const result = await acknowledgeNoticeAction(currentNotice.id);

    if (!result.ok) {
      setIsSubmitting(false);
      toast.error(result.error.message ?? t("errors.acknowledgeFailed"));
      return false;
    }

    await onNoticeAcknowledged?.();
    setIsSubmitting(false);

    if (isExternalNotice && closeExternal) {
      onNoticeClose?.();
    } else if (!isExternalNotice) {
      setIsOpen(false);
    }

    return true;
  }

  async function handleAcknowledge() {
    await acknowledgeCurrentNotice();
  }

  async function handleOpenAction() {
    if (!actionUrl) {
      return;
    }

    const didAcknowledge = await acknowledgeCurrentNotice({
      closeExternal: false,
    });

    if (!didAcknowledge) {
      return;
    }

    window.location.assign(actionUrl);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isLegalNotice && !nextOpen) {
      return;
    }

    if (isExternalNotice) {
      if (!nextOpen) {
        if (isAnnouncementNotice) {
          void acknowledgeCurrentNotice();
          return;
        }

        onNoticeClose?.();
      }
      return;
    }

    setIsOpen(nextOpen);
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="bg-background top-0 left-0 grid h-dvh w-screen max-w-none! translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100vw-4rem)] sm:max-w-xl! sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border [&>button]:top-5 [&>button]:right-5 sm:[&>button]:top-6 sm:[&>button]:right-6"
        showCloseButton={!isLegalNotice}
        onEscapeKeyDown={
          isLegalNotice ? (event) => event.preventDefault() : undefined
        }
        onPointerDownOutside={
          isLegalNotice ? (event) => event.preventDefault() : undefined
        }
      >
        <div className="flex h-16 items-center px-6 sm:px-8">
          <ThemedLogo LogoComponent={SokosumiLogo} height={16} width={123} />
        </div>

        <div className="app-scrollbar min-h-0 overflow-y-auto overscroll-contain px-6 py-4 sm:px-10">
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none">
            {coverUrl ? (
              <NoticeCover
                url={coverUrl}
                alt={noticeTitle}
                controls
                className="rounded-xl border"
              />
            ) : null}
            <div className="text-center">
              <DialogTitle className="mt-6 text-3xl leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
                {noticeTitle}
              </DialogTitle>
              <DialogDescription
                className={
                  noticeSummary
                    ? "text-muted-foreground mx-auto mt-2 max-w-[42ch] text-base leading-[1.6] text-balance"
                    : "sr-only"
                }
              >
                {noticeSummary ?? noticeTitle}
              </DialogDescription>
            </div>
            {parsedTemplate.bodyMarkdown.trim() ? (
              <Markdown className="mx-auto mt-6 max-w-md text-sm">
                {parsedTemplate.bodyMarkdown}
              </Markdown>
            ) : null}
          </div>
        </div>

        <div className="bg-background flex min-h-20 items-center justify-between gap-3 px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8">
          {isLegalNotice ? (
            <span />
          ) : (
            <Button
              variant="ghost"
              className="text-muted-foreground h-11 px-4"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("actions.close")}
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            className="h-11 rounded-full px-6"
            onClick={actionUrl ? handleOpenAction : handleAcknowledge}
            loading={isSubmitting}
          >
            {actionUrl
              ? (actionLabel ?? t("actions.openLink"))
              : t("actions.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A notice's cover: a video plays muted on a loop, like a GIF. */
export function NoticeCover({
  url,
  alt,
  controls = false,
  className,
}: {
  url: string;
  alt: string;
  controls?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted overflow-hidden", className)}>
      {isVideoUrl(url) ? (
        <video
          src={url}
          autoPlay
          loop
          muted
          playsInline
          controls={controls}
          className="aspect-video w-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="aspect-video w-full object-cover" />
      )}
    </div>
  );
}
