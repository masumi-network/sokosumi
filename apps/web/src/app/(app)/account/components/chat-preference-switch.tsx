"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ChatPreferenceSwitchProps {
  title: string;
  description: string;
  initialValue: boolean;
  /** Saves the new value; rejects to put the switch back. */
  save: (value: boolean) => Promise<void>;
  messages: {
    loading: string;
    enabled: string;
    disabled: string;
    error: string;
  };
}

/**
 * One chat preference as a labelled switch, saved as it flips. The value is
 * put back on the chain rather than inside the toast, so it is restored
 * whether or not the toast renders its error, and never after the flag that
 * re-enables the switch.
 */
export function ChatPreferenceSwitch({
  title,
  description,
  initialValue,
  save,
  messages,
}: ChatPreferenceSwitchProps) {
  const switchId = useId();
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);

  function handleToggle(nextValue: boolean) {
    if (isSaving) return;
    const previous = value;
    setValue(nextValue);
    setIsSaving(true);
    const updatePromise = Promise.resolve()
      .then(() => save(nextValue))
      .catch((error: unknown) => {
        setValue(previous);
        throw error;
      })
      .finally(() => setIsSaving(false));
    toast.promise(updatePromise, {
      loading: messages.loading,
      success: () => (nextValue ? messages.enabled : messages.disabled),
      error: () => messages.error,
    });
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label htmlFor={switchId} className="text-sm font-normal">
          {title}
        </Label>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch
        id={switchId}
        checked={value}
        disabled={isSaving}
        onCheckedChange={handleToggle}
      />
    </div>
  );
}
