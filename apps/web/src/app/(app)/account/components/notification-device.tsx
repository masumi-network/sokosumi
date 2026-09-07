"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import type { DeviceChoice } from "./use-notification-delivery";

/**
 * This browser, as a row of the same card.
 *
 * Every other row is about what Sokosumi sends. This one is about where the
 * reader is standing: the push column writes the account, so a reader who
 * wants their laptop quiet while their phone keeps buzzing has nowhere else to
 * say so. Off, this browser drops its own subscription and the account keeps
 * everything it was set to.
 *
 * It has no channel cells, because it is not a kind and answers no column. It
 * is last for the same reason, under the rows it changes nothing about.
 *
 * The name lines up with the group names rather than with their chevrons.
 * There is nothing here to fold, and a name starting where the chevrons do
 * would read as a heading over the rows above it.
 */
export function DeviceRow({ device }: { device: DeviceChoice }) {
  const t = useTranslations("App.Account.Notifications");
  const hintId = useId();

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 pl-6">
        <p className="text-sm leading-5">{t("deviceTitle")}</p>
        <p id={hintId} className="text-muted-foreground text-sm leading-5">
          {t(device.enabled ? "deviceOnHint" : "deviceOffHint")}
        </p>
      </div>
      <div className="shrink-0 pl-6 sm:pl-0">
        <Switch
          checked={device.enabled}
          // Reachable while a write is in flight, and doing nothing, which is
          // the rule every control on this card keeps: one the browser
          // disables drops out of the tab order under the reader's finger.
          aria-disabled={device.saving || undefined}
          aria-label={t("deviceAriaLabel")}
          aria-describedby={hintId}
          className="aria-disabled:opacity-50"
          onCheckedChange={(next) => {
            if (device.saving) {
              return;
            }

            device.onChange(next);
          }}
        />
      </div>
    </div>
  );
}
