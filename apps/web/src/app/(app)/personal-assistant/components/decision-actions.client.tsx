"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resolveSokoBotDecisionAction } from "@/lib/actions/soko-bot/action";

type Resolution = "ACCEPT" | "REJECT";

/** Accept / reject one pending decision; the page re-reads Core after. */
interface DecisionActionsProps {
  decisionId: string;
  /** Hide Accept when the proposal is malformed (e.g. hire without ceiling). */
  acceptDisabled?: boolean;
}

export function DecisionActions({
  decisionId,
  acceptDisabled = false,
}: DecisionActionsProps) {
  const t = useTranslations("App.SokoBot.Decisions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState<Resolution | null>(null);

  function resolve(resolution: Resolution) {
    setInFlight(resolution);
    startTransition(async () => {
      const result = await resolveSokoBotDecisionAction({
        decisionId,
        resolution,
      });
      setInFlight(null);
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      toast.success(resolution === "ACCEPT" ? t("accepted") : t("rejected"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        disabled={isPending || acceptDisabled}
        aria-disabled={acceptDisabled || undefined}
        title={acceptDisabled ? t("acceptUnavailable") : undefined}
        onClick={() => resolve("ACCEPT")}
      >
        {inFlight === "ACCEPT" ? t("accepting") : t("accept")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => resolve("REJECT")}
      >
        {inFlight === "REJECT" ? t("rejecting") : t("reject")}
      </Button>
    </div>
  );
}
