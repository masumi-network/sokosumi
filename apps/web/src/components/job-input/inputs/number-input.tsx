import type { InputNumberSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function NumberInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.NUMBER, InputNumberSchemaType>) {
  const { data } = jobInputSchema;

  const value =
    field.value === null || field.value === undefined
      ? ""
      : typeof field.value === "string"
        ? field.value
        : String(field.value);

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="number"
      {...field}
      {...controlProps}
      value={value}
    />
  );
}
