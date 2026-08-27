"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";

interface OrganizationSeatSettingsFieldsProps {
  inputId: string;
  memberCount: number;
  targetSeats: number;
  onTargetSeatsChange: (value: number) => void;
}

export function resolveMinimumOrganizationSeats(): number {
  return 1;
}

export function resolveTargetOrganizationSeats(currentSeats: number): number {
  return Math.max(currentSeats, resolveMinimumOrganizationSeats());
}

export function OrganizationSeatSettingsFields({
  inputId,
  memberCount,
  targetSeats,
  onTargetSeatsChange,
}: OrganizationSeatSettingsFieldsProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const minimumSeats = resolveMinimumOrganizationSeats();
  const hintText = t("seatsInputHint", {
    members: memberCount,
    minimum: minimumSeats,
  });

  return (
    <div className="space-y-2 md:grid md:grid-cols-[minmax(0,1fr)_240px] md:items-start md:gap-6 md:space-y-0">
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("seatsInputLabel")}
        </label>
        <p className="text-muted-foreground hidden text-xs md:block">
          {hintText}
        </p>
      </div>
      <div className="space-y-2">
        <Input
          id={inputId}
          type="number"
          min={minimumSeats}
          value={targetSeats}
          onChange={(event) => {
            const parsedValue = Number.parseInt(event.target.value, 10);
            if (Number.isNaN(parsedValue)) return;
            onTargetSeatsChange(parsedValue);
          }}
        />
        <p className="text-muted-foreground text-xs md:hidden">{hintText}</p>
      </div>
    </div>
  );
}
