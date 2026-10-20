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
import { resetSokoBotMemoryAction } from "@/lib/actions/soko-bot/action";
import { useSokoBotTargetId } from "./soko-bot-target";

export function ResetMemoryButton() {
  const t = useTranslations("App.SokoBot.Memory");
  const router = useRouter();
  const botId = useSokoBotTargetId();
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={isPending}>
          {t("reset")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("resetTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("resetDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("resetCancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await resetSokoBotMemoryAction({ botId });
                if (!result.ok) {
                  toast.error(result.error.message ?? t("resetError"));
                  return;
                }
                toast.success(t("resetDone"));
                router.refresh();
              })
            }
          >
            {t("resetConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
