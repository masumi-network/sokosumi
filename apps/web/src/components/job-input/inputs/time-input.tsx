import type { InputTimeSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function TimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.TIME, InputTimeSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      type="time"
      placeholder={data?.placeholder ?? undefined}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
