"use client";

import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setTaskDueOn } from "@/lib/actions/task/action";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import { TaskDueBadge } from "./task-due-badge";
import { ROW_TRIGGER_CLASS } from "./task-status-picker";

interface TaskMetadataDueFieldProps {
  taskId: string;
  /** `YYYY-MM-DD`, or null when no due date is set. */
  dueOn: string | null;
  status: TaskStatus;
}

export function TaskMetadataDueField({
  taskId,
  dueOn,
  status,
}: TaskMetadataDueFieldProps) {
  const t = useTranslations("App.Tasks.Due");
  const inputId = useId();
  const hintId = useId();
  const [current, setCurrent] = useState(dueOn);
  const [draft, setDraft] = useState(dueOn ?? "");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save(next: string | null) {
    setOpen(false);
    if (next === current) return;

    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      try {
        const result = await setTaskDueOn({ taskId, dueOn: next });
        if (!result.ok) {
          setCurrent(previous);
          toast.error(t("updateError"));
          return;
        }
      } catch (error) {
        console.error("Failed to update task due date", error);
        setCurrent(previous);
        toast.error(t("updateError"));
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) save(draft);
  }

  function handleOpenChange(next: boolean) {
    if (next) setDraft(current ?? "");
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-describedby={hintId}
          disabled={isPending}
          className={cn(
            "focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2 disabled:cursor-not-allowed",
            ROW_TRIGGER_CLASS,
          )}
        >
          {current ? (
            <TaskDueBadge dueOn={current} status={status} variant="row" />
          ) : (
            <>
              <span className="flex size-5 shrink-0 items-center justify-center">
                <CalendarPlus
                  className="text-muted-foreground size-4"
                  aria-hidden
                />
              </span>
              <span className="text-muted-foreground truncate">
                {t("none")}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      {/* The visible label names the button (WCAG 2.5.3); the action is its description. */}
      <span id={hintId} className="sr-only">
        {current ? t("change") : t("set")}
      </span>
      <PopoverContent align="start" className="w-64">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t("label")}
          </label>
          <Input
            id={inputId}
            type="date"
            required
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => save(null)}
              >
                {t("clear")}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!draft}>
              {t("save")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
