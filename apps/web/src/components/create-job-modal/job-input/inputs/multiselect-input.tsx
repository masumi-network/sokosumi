import { InputMultiselectSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import MultipleSelect from "@/components/multiple-select";

import { JobInputComponentProps } from "./types";

export function MultiselectInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.MULTISELECT, InputMultiselectSchemaType>) {
  const {
    name,
    data: { values },
  } = jobInputSchema;

  return (
    <MultipleSelect
      name={name}
      value={
        Array.isArray(field.value)
          ? (field.value as number[]).map((index) => values[index])
          : []
      }
      onChange={(optionValues) =>
        field.onChange(
          optionValues.map((optionValue) => values.indexOf(optionValue)).sort(),
        )
      }
      options={values}
      className="w-full"
    />
  );
}
