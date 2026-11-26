"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { reactivateSokoBotAction } from "@/lib/actions/soko-bot/action";

/** Brings an archived shared bot back. Only a viewer who may manage it sees this. */
export function ReactivateSharedBotButton({
  botId,
  name,
}: {
  botId: string;
  /** Names the bot to screen readers where several are listed. */
  name?: string;
}) {
  const t = useTranslations("App.SokoBots.Shared.Archived");
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      loading={isPending}
      aria-label={name ? t("reactivateName", { name }) : undefined}
      onClick={() =>
        startTransition(async () => {
          const result = await reactivateSokoBotAction({ botId });
          if (!result.ok) {
            toast.error(result.error.message ?? t("reactivateError"));
            return;
          }
          toast.success(t("reactivated"));
        })
      }
    >
      {t("reactivate")}
    </Button>
  );
}
