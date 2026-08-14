import type { InputBooleanSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Switch } from "@/components/ui/switch";

import type { JobInputComponentProps } from "./types";

export function BooleanInput({
  id,
  field,
  controlProps,
}: JobInputComponentProps<InputType.BOOLEAN, InputBooleanSchemaType>) {
  return (
    <Switch
      id={id}
      checked={typeof field.value === "boolean" ? field.value : false}
      onCheckedChange={field.onChange}
      disabled={field.disabled}
      aria-describedby={controlProps?.["aria-describedby"]}
      aria-invalid={controlProps?.["aria-invalid"]}
    />
  );
}
