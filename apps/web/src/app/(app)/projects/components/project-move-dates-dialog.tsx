"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { shiftProjectDueDatesAction } from "@/app/projects/actions";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** Core moves at most this many Tasks at once and refuses a bigger project. */
const MAX_TASKS = 100;
const MAX_DAYS = 365;
const PREVIEW_ROWS = 5;
const PREVIEW_DELAY_MS = 300;

type Preview = Awaited<ReturnType<typeof shiftProjectDueDatesAction>>;
type PreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; preview: Preview };

interface ProjectMoveDatesDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/** A whole number of days in range, or null while the field says otherwise. */
function parseDays(value: string): number | null {
  const days = Number(value.trim());
  return Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? days : null;
}

/**
 * Moves every open due date in a project by the same number of days, later
 * or earlier, so the plan keeps its spacing. Shows which Tasks move and to
 * which day before anything changes.
 */
export function ProjectMoveDatesDialog({
  projectId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: ProjectMoveDatesDialogProps) {
  const t = useTranslations("App.Projects.Detail.moveDates");
  const format = useFormatter();
  const router = useRouter();
  const [daysInput, setDaysInput] = useState("7");
  const [direction, setDirection] = useState<"later" | "earlier">("later");
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [isMoving, startMoving] = useTransition();

  const count = parseDays(daysInput);
  const days = count === null ? null : direction === "later" ? count : -count;

  useEffect(() => {
    if (!open || days === null) return;
    let current = true;
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      shiftProjectDueDatesAction({ projectId, days, preview: true })
        .then((preview) => {
          if (current) setState({ status: "ready", preview });
        })
        .catch(() => {
          if (current) setState({ status: "error" });
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, projectId, days]);

  const preview = state.status === "ready" ? state.preview : null;
  const total = preview?.total ?? 0;
  const canMove =
    days !== null && preview !== null && total > 0 && total <= MAX_TASKS;

  function formatDay(day: string) {
    return format.dateTime(new Date(`${day}T00:00:00.000Z`), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }

  function handleMove() {
    if (!canMove || days === null) return;
    startMoving(async () => {
      try {
        const result = await shiftProjectDueDatesAction({ projectId, days });
        toast.success(
          t("moved", { count: result.tasks.length }),
          result.skipped > 0
            ? { description: t("skipped", { count: result.skipped }) }
            : undefined,
        );
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error(t("moveError"));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isMoving) onOpenChange(next);
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleMove();
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor={`project-move-days-${projectId}`}>
                {t("daysLabel")}
              </Label>
              <Input
                id={`project-move-days-${projectId}`}
                name="days"
                inputMode="numeric"
                autoComplete="off"
                className="w-24 tabular-nums"
                value={daysInput}
                onChange={(event) => setDaysInput(event.target.value)}
                aria-invalid={count === null}
                aria-describedby={
                  count === null
                    ? `project-move-days-error-${projectId}`
                    : undefined
                }
                disabled={isMoving}
              />
            </div>
            <RadioGroup
              aria-label={t("directionLabel")}
              className="flex gap-4 pb-2"
              value={direction}
              onValueChange={(value) =>
                setDirection(value === "earlier" ? "earlier" : "later")
              }
              disabled={isMoving}
            >
              {(["later", "earlier"] as const).map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={value}
                    id={`project-move-${value}-${projectId}`}
                  />
                  <Label htmlFor={`project-move-${value}-${projectId}`}>
                    {t(value)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          {count === null ? (
            <p
              id={`project-move-days-error-${projectId}`}
              className="text-destructive text-sm"
            >
              {t("daysError", { max: MAX_DAYS })}
            </p>
          ) : null}

          <div aria-live="polite" className="min-h-24 space-y-2 text-sm">
            {count === null ? null : state.status === "loading" ? (
              <p className="text-muted-foreground">{t("checking")}</p>
            ) : state.status === "error" ? (
              <p className="text-destructive">{t("previewError")}</p>
            ) : total === 0 ? (
              <p className="text-muted-foreground">{t("empty")}</p>
            ) : total > MAX_TASKS ? (
              <p>{t("tooMany", { count: total, max: MAX_TASKS })}</p>
            ) : (
              <>
                <p className="font-medium">{t("summary", { count: total })}</p>
                <ul className="divide-border divide-y rounded-md border">
                  {state.preview.tasks.slice(0, PREVIEW_ROWS).map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {task.name}
                      </span>
                      <span className="text-muted-foreground flex shrink-0 items-center gap-1 tabular-nums">
                        <span>{formatDay(task.from)}</span>
                        <ArrowRight className="size-3" aria-label={t("to")} />
                        <span className="text-foreground">
                          {formatDay(task.to)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {total > PREVIEW_ROWS ? (
                  <p className="text-muted-foreground">
                    {t("more", { count: total - PREVIEW_ROWS })}
                  </p>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isMoving}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={isMoving} disabled={!canMove}>
              {t("confirm", { count: total })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
