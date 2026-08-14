import type { InputTelSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function TelInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.TEL, InputTelSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="tel"
      {...field}
      {...controlProps}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
