import type { InputTextSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function TextInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.TEXT, InputTextSchemaType>) {
  const { data } = jobInputSchema;
  const defaultValue = data?.default ?? "";

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="text"
      {...field}
      {...controlProps}
      value={typeof field.value === "string" ? field.value : defaultValue}
    />
  );
}
