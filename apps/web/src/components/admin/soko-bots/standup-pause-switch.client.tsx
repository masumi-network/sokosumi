"use client";

import type { SokoBotAvailability } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setSokoBotAvailabilityAction } from "@/lib/actions/admin-soko-bots/action";

/** Pauses every organization's daily agent stand-up at once, or resumes them. */
export function StandupPauseSwitch({
  initial,
}: {
  initial: SokoBotAvailability;
}) {
  const t = useTranslations("App.Admin.SokoBots.StandupSwitch");
  const [availability, setAvailability] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle(standupPaused: boolean) {
    startTransition(async () => {
      const result = await setSokoBotAvailabilityAction({
        input: { disabled: availability.disabled, standupPaused },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      setAvailability(result.value);
      toast.success(standupPaused ? t("paused") : t("resumed"));
    });
  }

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span
        aria-hidden
        className={
          availability.standupPaused
            ? "bg-muted-foreground size-1.5 rounded-full"
            : "bg-semantic-success size-1.5 rounded-full"
        }
      />
      <span>
        {availability.standupPaused ? t("statePaused") : t("stateRunning")}
      </span>
      <Button
        variant="link"
        size="sm"
        disabled={pending}
        className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs"
        onClick={() => toggle(!availability.standupPaused)}
      >
        {availability.standupPaused ? t("resume") : t("pause")}
      </Button>
    </div>
  );
}
