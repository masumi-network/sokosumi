"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

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

interface SocialPostMoveDialogProps {
  item: SocialPostCalendarItem;
  /** IANA zone the wall-clock input is read in: the calendar's. */
  timeZone: string;
  onClose: () => void;
  /** Moves the post the way a drop does: optimistic, rolled back on failure. */
  onMove: (scheduledAt: Date) => void;
}

/**
 * Picks a new time for one post without a drag: the keyboard and touch way
 * to do what dropping it on another day does.
 */
export function SocialPostMoveDialog({
  item,
  timeZone,
  onClose,
  onMove,
}: SocialPostMoveDialogProps) {
  const t = useTranslations("App.Calendar");
  const locale = useLocale();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(() =>
    utcToDateTimeLocalInTimezone(item.scheduledAt, timeZone),
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const scheduledAt = zonedDateTimeLocalToUtc(value, timeZone);
    if (!scheduledAt) {
      setError(t("socialMove.invalid"));
      return;
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError(t("socialMove.past"));
      return;
    }
    onClose();
    onMove(scheduledAt);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
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
            handleSubmit();
          }}
        >
          <Label htmlFor={inputId}>{t("socialMove.label")}</Label>
          <Input
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
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
          <Button onClick={onClose} type="button" variant="outline">
            {t("socialMove.cancel")}
          </Button>
          <Button form={`${inputId}-form`} type="submit" variant="primary">
            {t("socialMove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
