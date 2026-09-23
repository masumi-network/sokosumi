"use client";

import { useTranslations } from "next-intl";
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
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { utcToDateTimeLocalInTimezone } from "@/lib/schedules/zoned-datetime";

/** `datetime-local` value for a Date in the browser's own time zone. */
function toDateTimeLocalInput(date: Date): string {
  return utcToDateTimeLocalInTimezone(date, getDefaultTimezone());
}

interface TaskRunAtModalProps {
  /** The Run at already set on the form, as an ISO string. */
  runAt: string | null;
  onApply: (runAt: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * Picks the one time a Task starts, in the browser's local time. Mount it only
 * while open, so every opening starts from the form's current Run at.
 */
export function TaskRunAtModal({
  runAt,
  onApply,
  onClear,
  onClose,
}: TaskRunAtModalProps) {
  const t = useTranslations("App.Tasks.RunAt");
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(() =>
    runAt ? toDateTimeLocalInput(new Date(runAt)) : "",
  );
  const [hasError, setHasError] = useState(false);

  function handleApply() {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime()) || date <= new Date()) {
      setHasError(true);
      return;
    }
    onApply(date.toISOString());
    onClose();
  }

  function handleClear() {
    onClear();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("label")}</Label>
          <Input
            id={inputId}
            type="datetime-local"
            value={value}
            min={toDateTimeLocalInput(new Date())}
            aria-invalid={hasError}
            aria-describedby={hasError ? errorId : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setHasError(false);
            }}
          />
          {hasError ? (
            <p id={errorId} className="text-destructive text-sm">
              {t("notInFuture")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {runAt ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={handleClear}
            >
              {t("clear")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={handleApply}>
            {t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
