import { Switch } from "@/components/ui/switch";
import { JobInputBooleanSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function BooleanInput({
  id,
  field,
}: JobInputComponentProps<
  ValidJobInputTypes.BOOLEAN,
  JobInputBooleanSchemaType
>) {
  return (
    <Switch
      id={id}
      checked={typeof field.value === "boolean" ? field.value : false}
      onCheckedChange={field.onChange}
      disabled={field.disabled}
    />
  );
}
