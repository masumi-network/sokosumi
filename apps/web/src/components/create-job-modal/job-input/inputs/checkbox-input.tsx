import { InputCheckboxSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Checkbox } from "@/components/ui/checkbox";

import { JobInputComponentProps } from "./types";

export function CheckboxInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.CHECKBOX, InputCheckboxSchemaType>) {
  const { data } = jobInputSchema;

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
