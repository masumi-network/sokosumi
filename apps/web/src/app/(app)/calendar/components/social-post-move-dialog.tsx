"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTimezoneLabel } from "@/lib/schedules/timezones";
import {
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  rescheduleSocialPost,
  useReportSocialRescheduleFailure,
} from "./social-post-change";

interface SocialPostMoveDialogProps {
  item: SocialPostCalendarItem;
  /** IANA zone the wall-clock input is read in: the calendar's. */
  timeZone: string;
  onClose: () => void;
}

/**
 * Reschedules one post without a drag: the keyboard and touch way to do what
 * dropping a post on another day does, through the same action and revision.
 */
export function SocialPostMoveDialog({
  item,
  timeZone,
  onClose,
}: SocialPostMoveDialogProps) {
  const t = useTranslations("App.Calendar");

  const locale = useLocale();
  const router = useRouter();
  const reportFailure = useReportSocialRescheduleFailure();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(() =>
    utcToDateTimeLocalInTimezone(item.scheduledAt, timeZone),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (isPending) return;
    const scheduledAt = zonedDateTimeLocalToUtc(value, timeZone);
    if (!scheduledAt) {
      setError(t("socialMove.invalid"));
      return;
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError(t("socialMove.past"));
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await rescheduleSocialPost(item, scheduledAt);
      if (!result.ok) {
        // The post changed elsewhere: the refreshed calendar is the new start.
        if (
          result.error.kind ===
          CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT
        ) {
          reportFailure(result.error);
          onClose();
          return;
        }
        setError(result.error.message || t("socialMove.failed"));
        return;
      }
      toast.success(t("socialMove.done"));
      onClose();
      router.refresh();
    } catch {
      setError(t("socialMove.failed"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("socialMove.title")}</DialogTitle>
          <DialogDescription>
            {t("socialMove.description", {
              zone: formatTimezoneLabel(timeZone, locale, item.scheduledAt),
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="bg-card-background text-muted-foreground line-clamp-2 rounded-md px-3 py-2 text-sm">
          {item.text || t("socialPost.mediaOnly")}
        </p>
        <form
          className="space-y-2"
          id={`${inputId}-form`}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Label htmlFor={inputId}>{t("socialMove.label")}</Label>
          <Input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            disabled={isPending}
            id={inputId}
            onChange={(event) => setValue(event.target.value)}
            type="datetime-local"
            value={value}
          />
        </form>
        {error ? (
          <p className="text-destructive text-sm" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            {t("socialMove.cancel")}
          </Button>
          <Button
            form={`${inputId}-form`}
            loading={isPending}
            type="submit"
            variant="primary"
          >
            {t("socialMove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
