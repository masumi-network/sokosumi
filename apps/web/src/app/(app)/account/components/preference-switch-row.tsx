"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface PreferenceSwitchRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (nextValue: boolean) => void;
  /** Spacing against whatever sits above the row. The row owns no margin. */
  className?: string;
}

/**
 * One account preference: a label, the sentence under it, and the switch.
 *
 * The two account cards render the same row, so it lives here rather than in
 * either of them. It holds the pairing a caller keeps getting wrong: the
 * description is named by `aria-describedby`, so a screen reader reads the
 * condition the preference depends on instead of the label alone.
 *
 * The id is generated here. A caller that passed one in could pass the same
 * one twice, and nothing outside needs to name the switch.
 */
export function PreferenceSwitchRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
  className,
}: PreferenceSwitchRowProps) {
  const switchId = useId();
  const descriptionId = useId();

  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="space-y-0.5">
        <Label htmlFor={switchId} className="text-sm font-normal">
          {label}
        </Label>
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </p>
      </div>
      <Switch
        id={switchId}
        aria-describedby={descriptionId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
