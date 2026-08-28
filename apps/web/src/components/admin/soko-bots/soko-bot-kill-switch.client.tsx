"use client";

import { Power, PowerOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setSokoBotAvailabilityAction } from "@/lib/actions/admin-soko-bots/action";
import type { SokoBotAvailability } from "@/lib/clients/generated/core";

/**
 * Switches the whole feature off: no turns start and no model calls are made,
 * whatever would have started them. A database flag, so it takes effect at
 * once rather than waiting for a redeploy.
 */
export function SokoBotKillSwitch({
  initial,
}: {
  initial: SokoBotAvailability;
}) {
  const t = useTranslations("App.Admin.SokoBots.KillSwitch");
  const [availability, setAvailability] = useState(initial);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(disabled: boolean) {
    startTransition(async () => {
      const result = await setSokoBotAvailabilityAction({
        input: {
          disabled,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      setAvailability(result.value);
      toast.success(disabled ? t("disabled") : t("enabled"));
    });
  }

  return (
    <div
      className={
        availability.disabled
          ? "border-destructive/50 bg-destructive/5 space-y-3 rounded-lg border p-4"
          : "bg-card-background space-y-3 rounded-lg border p-4"
      }
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-xs">
          {availability.disabled
            ? t("stateDisabled", {
                reason: availability.disabledReason ?? t("noReason"),
              })
            : t("stateEnabled")}
        </p>
      </div>
      {availability.disabled ? (
        <Button size="sm" disabled={pending} onClick={() => toggle(false)}>
          <Power aria-hidden className="size-4" />
          {pending ? t("working") : t("enable")}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="max-w-sm"
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => toggle(true)}
          >
            <PowerOff aria-hidden className="size-4" />
            {pending ? t("working") : t("disable")}
          </Button>
        </div>
      )}
    </div>
  );
}
