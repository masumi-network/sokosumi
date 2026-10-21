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
import { archiveSokoBotAction } from "@/lib/actions/soko-bot/action";
import { SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { useSokoBotTargetId } from "./soko-bot-target";

export function ArchiveSokoBotButton() {
  const t = useTranslations("App.SokoBot.Settings");
  const router = useRouter();
  const botId = useSokoBotTargetId();
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={isPending}>
          {t("archive")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {botId ? t("sharedArchiveConfirmTitle") : t("archiveConfirmTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {botId
              ? t("sharedArchiveConfirmDescription")
              : t("archiveConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("archiveCancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await archiveSokoBotAction({ botId });
                if (!result.ok) {
                  toast.error(result.error.message ?? t("archiveError"));
                  return;
                }
                toast.success(t("archived"));
                // A shared bot's console closes with it; the roster lists it.
                if (botId) router.push(SOKO_BOTS_ROUTE);
                else router.refresh();
              })
            }
          >
            {t("archiveConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
