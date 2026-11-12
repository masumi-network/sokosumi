"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  DUE_DAY_FORMAT,
  dueDayDate,
  nextMonday,
  shiftDay,
} from "@/app/tasks/utils/task-due";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  type MovedTask,
  moveOverdueTasks,
  undoMoveOverdueTasks,
} from "../actions";

interface MoveOverdueMenuProps {
  /** The reader's day, `YYYY-MM-DD`. */
  today: string;
  /** How many overdue Tasks the move re-dates. */
  count: number;
}

/**
 * "Move overdue" on My day: re-dates every overdue Task to today, tomorrow
 * or next Monday in one step, then offers Undo.
 */
export function MoveOverdueMenu({ today, count }: MoveOverdueMenuProps) {
  const t = useTranslations("App.Chat.Landing.MyDay.MoveOverdue");
  const format = useFormatter();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const targets = [
    { key: "today", day: today },
    { key: "tomorrow", day: shiftDay(today, 1) },
    { key: "nextMonday", day: nextMonday(today) },
  ] as const;

  function dateOf(day: string) {
    return format.dateTime(dueDayDate(day), {
      ...DUE_DAY_FORMAT,
      weekday: "short",
    });
  }

  function handleUndo(to: string, moved: MovedTask[]) {
    startTransition(async () => {
      const undone = await undoMoveOverdueTasks({ to, moved }).catch(
        () => null,
      );
      if (!undone) {
        toast.error(t("undoError"));
        return;
      }
      toast.success(
        undone.restored < moved.length
          ? t("undonePartly", { count: undone.restored, total: moved.length })
          : t("undone", { count: undone.restored }),
      );
      router.refresh();
    });
  }

  function handleMove(to: string) {
    startTransition(async () => {
      const result = await moveOverdueTasks({ today, to }).catch(() => null);
      if (!result) {
        toast.error(t("error"));
        return;
      }
      const { moved, skipped } = result;
      const date = dateOf(to);
      if (moved.length === 0) {
        toast.info(t("nothingMoved"));
      } else {
        toast.success(
          skipped > 0
            ? t("movedPartly", {
                count: moved.length,
                total: moved.length + skipped,
                date,
              })
            : t("moved", { count: moved.length, date }),
          {
            // Undo is the only way back for up to 100 dates: it stays until
            // the reader uses or closes it, never on a timer.
            duration: Number.POSITIVE_INFINITY,
            closeButton: true,
            action: {
              label: t("undo"),
              onClick: () => handleUndo(to, moved),
            },
          },
        );
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isPending}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={isPending}
          data-testid="home-my-day-move-overdue"
        >
          <CalendarClock aria-hidden />
          {t("trigger", { count })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label", { count })}</DropdownMenuLabel>
        {targets.map(({ key, day }) => (
          <DropdownMenuItem key={key} onSelect={() => handleMove(day)}>
            <span className="flex-1">{t(`targets.${key}`)}</span>
            <span className="text-muted-foreground">{dateOf(day)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
