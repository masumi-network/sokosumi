import MultipleSelect from "@/components/multiple-select";
import {
  JobInputMultiselectSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function MultiselectInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.MULTISELECT,
  JobInputMultiselectSchemaType
>) {
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
