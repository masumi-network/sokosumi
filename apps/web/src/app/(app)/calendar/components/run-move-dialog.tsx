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
import {
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import type { ChangeableRun } from "./run-change";

interface RunMoveDialogProps {
  item: ChangeableRun;
  /** IANA zone the wall-clock input is interpreted in. */
  timeZone: string;
  onClose: () => void;
  /** Moves the Run: shown at once, put back with a toast when Core refuses. */
  onMove: (scheduledAt: Date) => void;
}

/** Moves one Task Schedule Run to another time; the rule stays as it is. */
export function RunMoveDialog({
  item,
  timeZone,
  onClose,
  onMove,
}: RunMoveDialogProps) {
  const t = useTranslations("App.Calendar");
  const inputId = useId();
  const [value, setValue] = useState(() =>
    utcToDateTimeLocalInTimezone(item.scheduledAt, timeZone),
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const scheduledAt = zonedDateTimeLocalToUtc(value, timeZone);
    if (!scheduledAt) {
      setError(t("runMove.invalid"));
      return;
    }
    // Core refuses a past time. Say so here, while the input is still open.
    if (scheduledAt.getTime() <= Date.now()) {
      setError(t("event.runInvalidTime"));
      return;
    }
    onClose();
    onMove(scheduledAt);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("runMove.title")}</DialogTitle>
          <DialogDescription>
            {t("runMove.description", { name: item.taskName })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("runMove.label")}</Label>
          <Input
            id={inputId}
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("runMove.cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit}>
            {t("runMove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
