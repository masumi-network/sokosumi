"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reactivateSokoBotAction } from "@/lib/actions/soko-bot/action";

/** Brings an archived shared bot back. Only a viewer who may manage it sees this. */
export function ReactivateSharedBotButton({ botId }: { botId: string }) {
  const t = useTranslations("App.SokoBots.Shared.Archived");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await reactivateSokoBotAction({ botId });
          if (!result.ok) {
            toast.error(result.error.message ?? t("reactivateError"));
            return;
          }
          toast.success(t("reactivated"));
          router.refresh();
        })
      }
    >
      {t("reactivate")}
    </Button>
  );
}
