import { InputStringSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function StringInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.STRING, InputStringSchemaType>) {
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
