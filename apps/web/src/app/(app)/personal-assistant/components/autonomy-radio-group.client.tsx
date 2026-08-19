"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SokoBotAutonomyLevel } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const LEVELS = [
  SokoBotAutonomyLevel.LOW,
  SokoBotAutonomyLevel.MEDIUM,
  SokoBotAutonomyLevel.HIGH,
] as const;

interface AutonomyRadioGroupProps {
  value: SokoBotAutonomyLevel;
  onChange: (value: SokoBotAutonomyLevel) => void;
  disabled?: boolean;
  compact?: boolean;
}

/** LOW / MEDIUM / HIGH autonomy picker with a one-line explanation each. */
export function AutonomyRadioGroup({
  value,
  onChange,
  disabled = false,
  compact = false,
}: AutonomyRadioGroupProps) {
  const t = useTranslations("App.SokoBot.Autonomy");
  const tLevel = useTranslations("Components.SokoBot.Autonomy");
  const groupId = useId();

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{t("label")}</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as SokoBotAutonomyLevel)}
        className={cn("gap-2", compact ? "grid-cols-1" : "sm:grid-cols-3")}
      >
        {LEVELS.map((level) => {
          const id = `${groupId}-${level}`;
          const checked = value === level;
          return (
            <Label
              key={level}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-left",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem id={id} value={level} className="mt-0.5" />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-sm font-medium">
                  {tLevel(level)}
                </span>
                <span className="text-muted-foreground block text-xs font-normal">
                  {t(`descriptions.${level}`)}
                </span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
