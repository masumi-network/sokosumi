import type { InputMultiselectSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import MultipleSelect from "@/components/multiple-select";

import type { JobInputComponentProps } from "./types";

export function MultiselectInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.MULTISELECT, InputMultiselectSchemaType>) {
  const {
    name,
    data: { values },
  } = jobInputSchema;

  return (
    <MultipleSelect
      id={id}
      name={name}
      disabled={field.disabled}
      aria-describedby={controlProps?.["aria-describedby"]}
      aria-invalid={controlProps?.["aria-invalid"]}
      value={
        Array.isArray(field.value)
          ? (field.value as number[]).map((index) => values[index])
          : []
      }
      onChange={(optionValues) => {
        if (field.disabled) return;
        field.onChange(
          optionValues.map((optionValue) => values.indexOf(optionValue)).sort(),
        );
      }}
      options={values}
      className="w-full"
    />
  );
}
