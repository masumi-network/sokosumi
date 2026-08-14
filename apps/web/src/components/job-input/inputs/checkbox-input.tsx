import type { InputCheckboxSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Checkbox } from "@/components/ui/checkbox";

import type { JobInputComponentProps } from "./types";

export function CheckboxInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.CHECKBOX, InputCheckboxSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
      <Checkbox
        id={id}
        checked={typeof field.value === "boolean" ? field.value : false}
        onCheckedChange={field.onChange}
        disabled={field.disabled}
        aria-describedby={controlProps?.["aria-describedby"]}
        aria-invalid={controlProps?.["aria-invalid"]}
      />
      <span>{data?.label}</span>
    </label>
  );
}
