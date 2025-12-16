import { InputTextSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function TextInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.TEXT, InputTextSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="text"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
