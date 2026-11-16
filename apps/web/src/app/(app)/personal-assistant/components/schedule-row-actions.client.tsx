"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  deleteSokoBotScheduleAction,
  updateSokoBotScheduleAction,
} from "@/lib/actions/soko-bot/action";
import { useSokoBotTargetId } from "./soko-bot-target";

interface ScheduleRowActionsProps {
  scheduleId: string;
  enabled: boolean;
  /** Built-in rhythms can be paused but not deleted. */
  deletable?: boolean;
  /** Told at once that a delete began (true), and that it failed (false). */
  onRemovedChange?: (removed: boolean) => void;
}

export function ScheduleRowActions({
  scheduleId,
  enabled,
  deletable = true,
  onRemovedChange,
}: ScheduleRowActionsProps) {
  const t = useTranslations("App.SokoBot.Schedules");
  const botId = useSokoBotTargetId();
  const [isPending, startTransition] = useTransition();
  // Committed state, not `useOptimistic`. `enabled` comes from the bot state,
  // which takes fresh props in an effect: one commit after the transition
  // ends. An optimistic value would show the old state in between.
  const [shown, setShown] = useState(enabled);
  // Whatever the server last told us. When that changes it wins over what
  // this switch remembers.
  const [savedEnabled, setSavedEnabled] = useState<boolean | null>(enabled);
  if (savedEnabled !== enabled) {
    setSavedEnabled(enabled);
    setShown(enabled);
  }

  function toggle(next: boolean) {
    setShown(next);
    startTransition(async () => {
      // A rejected call is a failed write too: the switch must not stay on
      // a state Core never saved.
      const result = await updateSokoBotScheduleAction({
        botId,
        input: { scheduleId, patch: { enabled: next } },
      }).catch(() => null);
      if (!result?.ok) {
        // Forget what the server said, so the next render takes its newest
        // word. That can differ from the state before the click when a
        // read landed while this write was open.
        setSavedEnabled(null);
        toast.error(result?.error.message ?? t("updateError"));
      }
    });
  }

  function remove() {
    onRemovedChange?.(true);
    startTransition(async () => {
      const result = await deleteSokoBotScheduleAction({
        scheduleId,
        botId,
      }).catch(() => null);
      if (!result?.ok) {
        onRemovedChange?.(false);
        toast.error(result?.error.message ?? t("deleteError"));
        return;
      }
      toast.success(t("deleted"));
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        checked={shown}
        onCheckedChange={toggle}
        disabled={isPending}
        aria-label={shown ? t("disable") : t("enable")}
      />
      {deletable ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              className="text-muted-foreground hover:text-destructive"
            >
              {t("delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>
                {t("deleteConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
