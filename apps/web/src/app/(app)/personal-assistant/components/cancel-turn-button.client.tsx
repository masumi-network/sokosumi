"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cancelSokoBotTurnAction } from "@/lib/actions/soko-bot/action";

export function CancelTurnButton({ turnId }: { turnId: string }) {
  const t = useTranslations("App.SokoBot.Turns");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelSokoBotTurnAction({ turnId });
          if (!result.ok) {
            toast.error(result.error.message ?? t("cancelError"));
            return;
          }
          toast.message(t("cancelRequested"));
          router.refresh();
        })
      }
    >
      {isPending ? t("cancelling") : t("cancel")}
    </Button>
  );
}
