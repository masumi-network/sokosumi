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

import { moveOverdueTasks, undoMoveOverdueTasks } from "../actions";

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

  function handleUndo(to: string, moved: { id: string; from: string }[]) {
    startTransition(async () => {
      const restored = await undoMoveOverdueTasks({ to, moved }).catch(
        () => null,
      );
      if (restored === null) {
        toast.error(t("undoError"));
        return;
      }
      toast.success(
        restored < moved.length
          ? t("undonePartly", { count: restored, total: moved.length })
          : t("undone", { count: restored }),
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
      const { moved, tried } = result;
      const date = dateOf(to);
      if (moved.length === 0) {
        toast.info(t("nothingMoved"));
      } else {
        toast.success(
          moved.length < tried
            ? t("movedPartly", { count: moved.length, total: tried, date })
            : t("moved", { count: moved.length, date }),
          {
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
