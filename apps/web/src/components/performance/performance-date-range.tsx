"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PerformanceDateRangeProps {
  idPrefix: string;
  from: string;
  until: string;
  minUntil?: string;
  fromLabel: string;
  untilLabel: string;
  invalid: boolean;
  onFromChange: (value: string) => void;
  onUntilChange: (value: string) => void;
}

export function PerformanceDateRange({
  idPrefix,
  from,
  until,
  minUntil,
  fromLabel,
  untilLabel,
  invalid,
  onFromChange,
  onUntilChange,
}: PerformanceDateRangeProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-from`}>{fromLabel}</Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={from}
          onChange={(event) => onFromChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-until`}>{untilLabel}</Label>
        <Input
          id={`${idPrefix}-until`}
          type="date"
          value={until}
          min={minUntil}
          aria-invalid={invalid}
          onChange={(event) => onUntilChange(event.target.value)}
        />
      </div>
    </>
  );
}
