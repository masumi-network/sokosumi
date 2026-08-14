import type { InputWeekSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function WeekInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.WEEK, InputWeekSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      type="week"
      placeholder={data?.placeholder ?? undefined}
      {...field}
      {...controlProps}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
