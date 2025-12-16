import { InputBooleanSchemaType, InputType } from "@sokosumi/masumi/schemas";

import { Switch } from "@/components/ui/switch";

import { JobInputComponentProps } from "./types";

export function BooleanInput({
  id,
  field,
}: JobInputComponentProps<InputType.BOOLEAN, InputBooleanSchemaType>) {
  return (
    <Switch
      id={id}
      checked={typeof field.value === "boolean" ? field.value : false}
      onCheckedChange={field.onChange}
      disabled={field.disabled}
    />
  );
}
