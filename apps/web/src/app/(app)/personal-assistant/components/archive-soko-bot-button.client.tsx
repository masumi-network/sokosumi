"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useTransition } from "react";
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
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { useSokoBotTargetId } from "./soko-bot-target";

const AGENTS_ROUTE = "/agents";

/**
 * Asks before archiving the console's bot, or the one `botId` names where a
 * list holds several (`null` for the viewer's own). `children` is its trigger;
 * a menu leaves it out and opens the dialog through `open`.
 */
export function ArchiveSokoBotDialog({
  botId: listedBotId,
  open,
  onOpenChange,
  children,
}: {
  botId?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("App.SokoBots.Archive");
  const router = useRouter();
  const pathname = usePathname();
  const consoleBotId = useSokoBotTargetId();
  const botId =
    listedBotId === undefined ? consoleBotId : (listedBotId ?? undefined);
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children}
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
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await archiveSokoBotAction({ botId });
                if (!result.ok) {
                  toast.error(result.error.message ?? t("archiveError"));
                  return;
                }
                toast.success(t("archived"));
                // A shared bot's console closes with it; Agents lists it.
                if (botId && pathname === sokoBotConsoleRoute(botId)) {
                  router.push(AGENTS_ROUTE);
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

export function ArchiveSokoBotButton({ botId }: { botId?: string | null }) {
  const t = useTranslations("App.SokoBots.Archive");
  return (
    <ArchiveSokoBotDialog botId={botId}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm">
          {t("archive")}
        </Button>
      </AlertDialogTrigger>
    </ArchiveSokoBotDialog>
  );
}
