"use client";

import type { Notice } from "@sokosumi/core-client";
import { NoticeKind } from "@sokosumi/core-client";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TaskFormModal } from "@/app/tasks/components/task-form-modal";
import { Button } from "@/components/ui/button";
import { acknowledgeNoticeAction } from "@/lib/actions/notice/action";
import { isVideoUrl } from "@/lib/utils/file-preview";
import { parseNoticeTemplate } from "@/lib/utils/notice-template";

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
    <TaskFormModal
      open={dialogOpen}
      onOpenChange={handleOpenChange}
      title={noticeTitle}
      cancelLabel={isLegalNotice ? undefined : t("actions.close")}
      isDismissDisabled={isSubmitting}
    >
      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 px-6 py-5 md:px-8">
          {coverUrl ? (
            <div className="bg-muted overflow-hidden rounded-lg border">
              {isVideoUrl(coverUrl) ? (
                <video
                  src={coverUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
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
          {noticeSummary ? (
            <p className="text-muted-foreground text-sm">{noticeSummary}</p>
          ) : null}
          <Markdown>{parsedTemplate.bodyMarkdown}</Markdown>
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t px-6 py-3 md:px-8">
        <Button
          type="button"
          className="min-w-28"
          onClick={actionUrl ? handleOpenAction : handleAcknowledge}
          loading={isSubmitting}
        >
          {actionUrl
            ? (actionLabel ?? t("actions.openLink"))
            : t("actions.confirm")}
        </Button>
      </div>
    </TaskFormModal>
  );
}
