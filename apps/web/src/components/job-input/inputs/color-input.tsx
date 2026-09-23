import type { InputColorSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { ColorPicker } from "@/components/ui/color-picker";

import type { JobInputComponentProps } from "./types";

export function ColorInput({
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<typeof InputType.COLOR, InputColorSchemaType>) {
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
