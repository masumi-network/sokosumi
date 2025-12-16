import { InputMonthSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function MonthInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.MONTH, InputMonthSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      type="month"
      placeholder={data?.placeholder ?? undefined}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
