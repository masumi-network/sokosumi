import { Input } from "@/components/ui/input";
import { JobInputMonthSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function MonthInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.MONTH, JobInputMonthSchemaType>) {
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
