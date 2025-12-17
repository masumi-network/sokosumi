import { InputEmailSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function EmailInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.EMAIL, InputEmailSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="email"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
