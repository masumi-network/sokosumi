import { isSingleOption } from "@/components/create-job-modal/job-input/util";
import MultipleSelect from "@/components/multiple-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobInputOptionSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function OptionInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.OPTION,
  JobInputOptionSchemaType
>) {
  const isSingle = isSingleOption(jobInputSchema);
  const {
    name,
    data: { values },
  } = jobInputSchema;

  if (isSingle) {
    return (
      <Select
        value={
          Array.isArray(field.value) && typeof field.value[0] === "number"
            ? values[field.value[0]]
            : ""
        }
        onValueChange={(value) => field.onChange([values.indexOf(value)])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{name}</SelectLabel>
            {values.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  return (
    <MultipleSelect
      name={name}
      value={
        Array.isArray(field.value)
          ? field.value
              .filter((index) => typeof index === "number")
              .map((index) => values[index])
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
