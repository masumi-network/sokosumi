import { ColorPicker } from "@/components/ui/color-picker";
import { JobInputColorSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function ColorInput({ field, jobInputSchema }: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputColorSchemaType;
  const defaultColor =
    (data as { default?: string } | undefined)?.default ?? "#000000";
  return (
    <ColorPicker
      value={typeof field.value === "string" ? field.value : defaultColor}
      onChange={(c) => field.onChange(c)}
      disabled={field.disabled}
      className="w-full"
    />
  );
}
