import { Checkbox } from "@/components/ui/checkbox";
import { JobInputBooleanSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function CheckboxInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const data = (jobInputSchema as JobInputBooleanSchemaType).data as
    | { label?: string }
    | undefined;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
      <Checkbox
        id={id}
        checked={typeof field.value === "boolean" ? field.value : false}
        onCheckedChange={field.onChange}
        disabled={field.disabled}
      />
      <span>{data?.label}</span>
    </label>
  );
}
