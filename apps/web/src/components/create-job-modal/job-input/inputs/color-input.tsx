import { ColorPicker } from "@/components/ui/color-picker";
import { JobInputColorSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function ColorInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.COLOR, JobInputColorSchemaType>) {
  const { data } = jobInputSchema;
  const defaultColor = data?.default ?? "#000000";

  return (
    <ColorPicker
      value={typeof field.value === "string" ? field.value : defaultColor}
      onChange={(c) => field.onChange(c)}
      disabled={field.disabled}
      className="w-full"
    />
  );
}
