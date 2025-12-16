import { InputColorSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { ColorPicker } from "@/components/ui/color-picker";

import { JobInputComponentProps } from "./types";

export function ColorInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.COLOR, InputColorSchemaType>) {
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
