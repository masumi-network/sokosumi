"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeNoticeAction } from "@/lib/actions/notice";
import type { Notice } from "@/lib/clients/generated/core";
import { NoticeKind } from "@/lib/clients/generated/core";
import { parseNoticeTemplate } from "@/lib/utils/notice-template";

interface NoticeDialogProps {
  pendingNotices: Notice[];
  noticeToShow?: Notice | null;
  onNoticeClose?: () => void;
  onNoticeAcknowledged?: () => Promise<void>;
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(url);
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
        className={
          isLegalNotice ? "sm:max-w-2xl [&>button]:hidden" : "sm:max-w-2xl"
        }
        onEscapeKeyDown={
          isLegalNotice ? (event) => event.preventDefault() : undefined
        }
        onPointerDownOutside={
          isLegalNotice ? (event) => event.preventDefault() : undefined
        }
      >
        <DialogHeader className="-mx-6 -mt-6 gap-0">
          {coverUrl ? (
            <div className="bg-muted overflow-hidden rounded-t-lg">
              {isVideoUrl(coverUrl) ? (
                <video
                  src={coverUrl}
                  controls
                  className="aspect-16/7 w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt={noticeTitle}
                  className="aspect-16/7 w-full object-cover"
                />
              )}
            </div>
          ) : null}
          <div className="space-y-2 px-6 pt-4">
            <DialogTitle>{noticeTitle}</DialogTitle>
            {noticeSummary ? (
              <DialogDescription>{noticeSummary}</DialogDescription>
            ) : null}
          </div>
        </DialogHeader>

        <div className="max-h-[45vh] overflow-y-auto pr-1">
          <Markdown>{parsedTemplate.bodyMarkdown}</Markdown>
        </div>

        <DialogFooter>
          {actionUrl ? (
            <Button
              type="button"
              variant="primary"
              onClick={handleOpenAction}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              {actionLabel ?? t("actions.openLink")}
            </Button>
          ) : null}
          {!actionUrl ? (
            <Button
              type="button"
              variant="primary"
              onClick={handleAcknowledge}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              {t("actions.confirm")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
