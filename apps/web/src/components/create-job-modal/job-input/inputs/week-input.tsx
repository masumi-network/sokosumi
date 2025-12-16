import { InputWeekSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function WeekInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.WEEK, InputWeekSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      type="week"
      placeholder={data?.placeholder ?? undefined}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
