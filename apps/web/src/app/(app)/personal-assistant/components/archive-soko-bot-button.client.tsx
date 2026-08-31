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

export function ArchiveSokoBotButton() {
  const t = useTranslations("App.SokoBot.Settings");
  const router = useRouter();
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
          <AlertDialogTitle>{t("archiveConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("archiveConfirmDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("archiveCancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const result = await archiveSokoBotAction({});
                if (!result.ok) {
                  toast.error(result.error.message ?? t("archiveError"));
                  return;
                }
                toast.success(t("archived"));
                router.refresh();
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
