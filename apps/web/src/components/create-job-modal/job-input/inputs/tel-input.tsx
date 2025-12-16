import { InputTelSchemaType, InputType } from "@sokosumi/masumi/schemas";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function TelInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.TEL, InputTelSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="tel"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
