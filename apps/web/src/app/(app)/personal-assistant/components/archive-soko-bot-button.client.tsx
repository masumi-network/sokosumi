"use client";

import { usePathname, useRouter } from "next/navigation";
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
import { SOKO_BOTS_ROUTE, sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { useSokoBotTargetId } from "./soko-bot-target";

/**
 * Archives the console's bot, or the one `botId` names where a list holds
 * several (`null` for the viewer's own).
 */
export function ArchiveSokoBotButton({
  botId: listedBotId,
}: {
  botId?: string | null;
}) {
  const t = useTranslations("App.SokoBots.Archive");
  const router = useRouter();
  const pathname = usePathname();
  const consoleBotId = useSokoBotTargetId();
  const botId =
    listedBotId === undefined ? consoleBotId : (listedBotId ?? undefined);
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" disabled={isPending}>
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
                // A shared bot's console closes with it; Soko Bots lists it.
                if (botId && pathname === sokoBotConsoleRoute(botId)) {
                  router.push(SOKO_BOTS_ROUTE);
                }
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
