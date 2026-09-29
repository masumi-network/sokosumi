"use client";

import { useRouter } from "next/navigation";
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
import {
  type ChangeableRun,
  changeRun,
  runChangeErrorKey,
  useReportRunChangeFailure,
} from "./run-change";

interface RunMoveDialogProps {
  item: ChangeableRun;
  /** IANA zone the wall-clock input is interpreted in. */
  timeZone: string;
  onClose: () => void;
}

/** Moves one Task Schedule Run to another time; the rule stays as it is. */
export function RunMoveDialog({ item, timeZone, onClose }: RunMoveDialogProps) {
  const t = useTranslations("App.Calendar");
  const router = useRouter();
  const reportRunChangeFailure = useReportRunChangeFailure();
  const inputId = useId();
  const [value, setValue] = useState(() =>
    utcToDateTimeLocalInTimezone(item.scheduledAt, timeZone),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    if (isPending) {
      return;
    }

    const scheduledAt = zonedDateTimeLocalToUtc(value, timeZone);
    if (!scheduledAt) {
      setError(t("runMove.invalid"));
      return;
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await changeRun(item, { action: "move", scheduledAt });
      if (!result.ok) {
        // The Run this dialog holds is out of date: start over from the
        // refreshed Calendar.
        if (result.error.kind === "stale") {
          reportRunChangeFailure("stale");
          onClose();
          return;
        }
        setError(t(runChangeErrorKey(result.error.kind)));
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t("event.runError"));
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
            {t("runMove.cancel")}
          </Button>
          <Button
            disabled={isPending}
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
          >
            {t("runMove.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
