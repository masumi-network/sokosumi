import type { InputNumberSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function NumberInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.NUMBER, InputNumberSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="number"
      {...field}
      value={Number(field.value).toString()}
    />
  );
}
