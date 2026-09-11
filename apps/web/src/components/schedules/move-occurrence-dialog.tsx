"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

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
import { rescheduleTaskOccurrence } from "@/lib/actions/task/action";
import {
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";
import {
  getTaskScheduleOperationId,
  type TaskScheduleOperationIdentity,
} from "@/lib/utils/task-schedule";
import { taskScheduleSeriesFeedbackKey } from "@/lib/utils/task-schedule-feedback";

interface MoveOccurrenceDialogProps {
  occurrenceId: string;
  /** Effective time the input is seeded from; sent back as an absolute instant. */
  scheduledAt: Date;
  taskId: string;
  /** IANA zone the wall-clock input is interpreted in. */
  timeZone: string;
  onClose: () => void;
}

/**
 * The keyboard/mobile counterpart to dragging a Calendar occurrence. It edits a
 * wall-clock time in the series' zone and sends the canonical UTC instant, the
 * same contract the drop handler uses.
 */
export function MoveOccurrenceDialog({
  occurrenceId,
  scheduledAt,
  taskId,
  timeZone,
  onClose,
}: MoveOccurrenceDialogProps) {
  const t = useTranslations("App.Tasks.Schedule.occurrenceMove");
  const tSeries = useTranslations("App.Tasks.Schedule.series");
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(() =>
    utcToDateTimeLocalInTimezone(scheduledAt, timeZone),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  // One UUID per distinct submitted time: a retry of the same attempt replays
  // on Core, while picking another time is a new operation.
  const operation = useRef<TaskScheduleOperationIdentity | null>(null);

  async function handleSubmit() {
    if (isPending) {
      return;
    }

    const target = zonedDateTimeLocalToUtc(value, timeZone);
    if (!target) {
      setError(t("invalid"));
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await rescheduleTaskOccurrence({
        taskId,
        occurrenceId,
        operationId: getTaskScheduleOperationId(
          { mode: "once", timezone: timeZone, oneTimeLocalIso: value },
          operation,
        ),
        scheduledAt: target.toISOString(),
      });

      if (!result.ok) {
        const feedbackKey = taskScheduleSeriesFeedbackKey(result.error.kind);
        setError(feedbackKey ? tSeries(feedbackKey) : t("error"));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("error"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
    >
      <DialogContent>
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
            disabled={isPending}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={isPending}
            type="button"
            variant="outline"
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            disabled={isPending}
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
