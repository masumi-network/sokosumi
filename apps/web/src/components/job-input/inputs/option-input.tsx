import type { InputOptionSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { isSingleOption } from "@/components/job-input/util";
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

import type { JobInputComponentProps } from "./types";

export function OptionInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.OPTION, InputOptionSchemaType>) {
  const isSingle = isSingleOption(jobInputSchema);
  const {
    name,
    data: { values },
  } = jobInputSchema;
  const selectedIndex =
    Array.isArray(field.value) && typeof field.value[0] === "number"
      ? field.value[0]
      : -1;

  if (isSingle) {
    return (
      <Select
        value={
          selectedIndex >= 0 && selectedIndex < values.length
            ? String(selectedIndex)
            : ""
        }
        disabled={field.disabled}
        onValueChange={(value) => {
          if (field.disabled) return;
          const nextIndex = Number(value);
          if (
            Number.isInteger(nextIndex) &&
            nextIndex >= 0 &&
            nextIndex < values.length
          ) {
            field.onChange([nextIndex]);
          }
        }}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-describedby={controlProps?.["aria-describedby"]}
          aria-invalid={
            controlProps?.["aria-invalid"] === true ||
            controlProps?.["aria-invalid"] === "true"
          }
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{name}</SelectLabel>
            {values.map((value, index) => (
              <SelectItem key={`${index}-${value}`} value={String(index)}>
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
      id={id}
      name={name}
      disabled={field.disabled}
      aria-describedby={controlProps?.["aria-describedby"]}
      aria-invalid={controlProps?.["aria-invalid"]}
      value={
        Array.isArray(field.value)
          ? field.value
              .filter((index) => typeof index === "number")
              .map((index) => values[index])
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
