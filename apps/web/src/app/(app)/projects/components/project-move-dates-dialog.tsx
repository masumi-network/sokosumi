"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Core moves at most this many Tasks at once and flags a bigger project. */
const MAX_TASKS = 100;
const MAX_DAYS = 365;
const PREVIEW_ROWS = 5;
const PREVIEW_DELAY_MS = 300;

type Preview = Awaited<ReturnType<typeof shiftProjectDueDatesAction>>;

interface ProjectMoveDatesDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/** Signed whole days in range, or null while the field says otherwise. */
function parseDays(value: string, direction: "later" | "earlier") {
  const days = Number(value.trim());
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return null;
  return direction === "later" ? days : -days;
}

/**
 * Moves every open due date in a project by the same number of days, later
 * or earlier, so the plan keeps its spacing. Shows which Tasks move and to
 * which day first; Confirm moves exactly those, from the days shown.
 */
export function ProjectMoveDatesDialog({
  projectId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: ProjectMoveDatesDialogProps) {
  const t = useTranslations("App.Projects.Detail.moveDates");
  const [daysInput, setDaysInput] = useState("7");
  const [direction, setDirection] = useState<"later" | "earlier">("later");
  const [isMoving, startMoving] = useTransition();

  const days = parseDays(daysInput, direction);
  const [previewDays] = useDebounce(days, PREVIEW_DELAY_MS);
  const query = useQuery({
    queryKey: ["project-due-date-shift", projectId, previewDays],
    queryFn: () =>
      shiftProjectDueDatesAction({ projectId, days: previewDays ?? 0 }),
    enabled: open && previewDays !== null,
    // Offline, say the check failed instead of showing "Checking…" forever,
    // and check again once back online ("always" turns that off by default).
    networkMode: "always",
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 0,
  });
  // Confirm only what is on screen for the days now in the field. A failed
  // refetch keeps the old data but shows the error, so it is not usable.
  const preview =
    previewDays === days && query.isSuccess && !query.isFetching
      ? query.data
      : undefined;
  const canMove =
    days !== null &&
    !!preview &&
    !preview.overLimit &&
    preview.tasks.length > 0;

  function handleMove() {
    if (!canMove || days === null || !preview) return;
    startMoving(async () => {
      try {
        const result = await shiftProjectDueDatesAction({
          projectId,
          days,
          tasks: preview.tasks.map(({ id, from }) => ({ id, from })),
        });
        toast.success(
          t("moved", { count: result.tasks.length }),
          result.skipped > 0
            ? { description: t("skipped", { count: result.skipped }) }
            : undefined,
        );
        onOpenChange(false);
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
      {/* One shrinkable column, so a long Task name wraps instead of
          widening the dialog past a phone screen; capped at the screen
          height and scrolling, so a long preview never pushes the title or
          the buttons off-screen. */}
      <DialogContent
        className="app-scrollbar max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
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
                aria-invalid={days === null}
                aria-describedby={
                  days === null
                    ? `project-move-days-error-${projectId}`
                    : undefined
                }
                disabled={isMoving}
              />
            </div>
            <ToggleGroup
              aria-label={t("directionLabel")}
              type="single"
              value={direction}
              onValueChange={(value) => {
                // Clicking the chosen direction again would clear it; keep it.
                if (value === "later" || value === "earlier") {
                  setDirection(value);
                }
              }}
              disabled={isMoving}
            >
              <ToggleGroupItem value="later">{t("later")}</ToggleGroupItem>
              <ToggleGroupItem value="earlier">{t("earlier")}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {days === null ? (
            <p
              id={`project-move-days-error-${projectId}`}
              className="text-destructive text-sm"
            >
              {t("daysError", { max: MAX_DAYS })}
            </p>
          ) : null}

          <div aria-live="polite" className="min-h-24 space-y-2 text-sm">
            {days === null ? null : (
              <MoveDatesPreview preview={preview} isError={query.isError} />
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
              {t("confirm", { count: preview?.tasks.length ?? 0 })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What Confirm would move: checking, an error, nothing, too much, or rows. */
function MoveDatesPreview({
  preview,
  isError,
}: {
  preview: Preview | undefined;
  isError: boolean;
}) {
  const t = useTranslations("App.Projects.Detail.moveDates");
  const format = useFormatter();
  const formatDay = (day: string) =>
    format.dateTime(new Date(`${day}T00:00:00.000Z`), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  if (isError) {
    return <p className="text-destructive">{t("previewError")}</p>;
  }
  if (!preview) {
    return <p className="text-muted-foreground">{t("checking")}</p>;
  }
  if (preview.overLimit) {
    return <p>{t("tooMany", { max: MAX_TASKS })}</p>;
  }
  const count = preview.tasks.length;
  if (count === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <>
      <p className="font-medium">{t("summary", { count })}</p>
      <ul className="divide-border divide-y rounded-md border">
        {preview.tasks.slice(0, PREVIEW_ROWS).map((task) => (
          <li key={task.id} className="flex items-start gap-3 px-3 py-2">
            {/* Wraps rather than truncates: the list is there to check
                which Tasks move, so every name stays readable in full. */}
            <span className="min-w-0 flex-1 break-words">{task.name}</span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums">
              <span>{formatDay(task.from)}</span>
              <ArrowRight className="size-3" aria-label={t("to")} />
              <span className="text-foreground">{formatDay(task.to)}</span>
            </span>
          </li>
        ))}
      </ul>
      {count > PREVIEW_ROWS ? (
        <p className="text-muted-foreground">
          {t("more", { count: count - PREVIEW_ROWS })}
        </p>
      ) : null}
    </>
  );
}
