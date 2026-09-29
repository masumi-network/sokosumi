"use client";

import { Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setSokoBotAvailabilityAction } from "@/lib/actions/admin-soko-bots/action";
import type { SokoBotAvailability } from "@/lib/clients/generated/core";

/**
 * Switches the whole feature off: no turns start and no model calls are made,
 * whatever would have started them. A database flag, so it takes effect at
 * once rather than waiting for a redeploy.
 *
 * Quiet while on (one line, the switch behind a confirmation) and loud while
 * off, because only the off state needs an operator's attention.
 */
export function SokoBotKillSwitch({
  initial,
}: {
  initial: SokoBotAvailability;
}) {
  const t = useTranslations("App.Admin.SokoBots.KillSwitch");
  const router = useRouter();
  const reasonId = useId();
  const [availability, setAvailability] = useState(initial);
  const [confirming, setConfirming] = useState(false);
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
      setConfirming(false);
      setReason("");
      toast.success(disabled ? t("disabled") : t("enabled"));
      // The page places the two states differently; let it re-render.
      router.refresh();
    });
  }

  if (availability.disabled) {
    return (
      <div className="border-semantic-destructive-tertiary bg-semantic-destructive-quinary flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("offTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("stateDisabled", {
              reason: availability.disabledReason ?? t("noReason"),
            })}
          </p>
        </div>
        <Button size="sm" disabled={pending} onClick={() => toggle(false)}>
          <Power aria-hidden className="size-4" />
          {pending ? t("working") : t("enable")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className="bg-semantic-success size-1.5 rounded-full"
        />
        <span>{t("stateEnabled")}</span>
        <Button
          variant="link"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs"
          onClick={() => setConfirming(true)}
        >
          {t("disableEllipsis")}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmTitle")}</DialogTitle>
            <DialogDescription>{t("confirmDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={reasonId}>{t("reasonLabel")}</Label>
            <Input
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => toggle(true)}
            >
              <PowerOff aria-hidden className="size-4" />
              {pending ? t("working") : t("disable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
