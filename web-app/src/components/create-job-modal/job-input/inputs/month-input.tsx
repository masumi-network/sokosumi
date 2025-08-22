import { Input } from "@/components/ui/input";
import { JobInputMonthSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function MonthInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputMonthSchemaType;
  return (
    <Input
      id={id}
      type="month"
      placeholder={data?.placeholder}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
