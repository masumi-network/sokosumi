"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
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

interface ScheduleRowActionsProps {
  scheduleId: string;
  enabled: boolean;
}

export function ScheduleRowActions({
  scheduleId,
  enabled,
}: ScheduleRowActionsProps) {
  const t = useTranslations("App.SokoBot.Schedules");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const result = await updateSokoBotScheduleAction({
        input: { scheduleId, patch: { enabled: next } },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("updateError"));
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteSokoBotScheduleAction({ scheduleId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("deleteError"));
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={isPending}
        aria-label={enabled ? t("disable") : t("enable")}
      />
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
    </div>
  );
}
