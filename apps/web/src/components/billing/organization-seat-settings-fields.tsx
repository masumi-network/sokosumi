"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SeatCountInputProps {
  id: string;
  /** `null` while the field is empty. */
  value: number | null;
  onChange: (value: number | null) => void;
}

interface OrganizationSeatSettingsFieldsProps {
  inputId: string;
  memberCount: number;
  targetSeats: number | null;
  onTargetSeatsChange: (value: number | null) => void;
}

export function resolveMinimumOrganizationSeats(): number {
  return 1;
}

export function resolveTargetOrganizationSeats(currentSeats: number): number {
  return Math.max(currentSeats, resolveMinimumOrganizationSeats());
}

export function SeatCountInput({ id, value, onChange }: SeatCountInputProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.Subscription",
  );
  const minimumSeats = resolveMinimumOrganizationSeats();

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={t("seatsCard.decrease")}
        disabled={value === null || value <= minimumSeats}
        onClick={() => {
          if (value !== null) onChange(value - 1);
        }}
        size="icon"
        type="button"
        variant="outline"
      >
        <Minus aria-hidden />
      </Button>
      <Input
        // The +/- buttons replace the browser's spinner, which also pushes the
        // number off-center.
        className="text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        id={id}
        min={minimumSeats}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(null);
            return;
          }
          const parsedValue = Number.parseInt(event.target.value, 10);
          if (!Number.isNaN(parsedValue)) onChange(parsedValue);
        }}
        type="number"
        value={value ?? ""}
      />
      <Button
        aria-label={t("seatsCard.increase")}
        onClick={() => onChange(value === null ? minimumSeats : value + 1)}
        size="icon"
        type="button"
        variant="outline"
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
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
  const hintText = t("seatsInputHint", { members: memberCount });

  return (
    <div className="space-y-2 md:grid md:grid-cols-[minmax(0,1fr)_240px] md:items-start md:gap-6 md:space-y-0">
      <div className="space-y-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("seatsCheckoutLabel")}
        </label>
        <p className="text-muted-foreground hidden text-xs md:block">
          {hintText}
        </p>
      </div>
      <div className="space-y-2">
        <SeatCountInput
          id={inputId}
          onChange={onTargetSeatsChange}
          value={targetSeats}
        />
        <p className="text-muted-foreground text-xs md:hidden">{hintText}</p>
      </div>
    </div>
  );
}
