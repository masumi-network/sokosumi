import { Input } from "@/components/ui/input";
import { JobInputWeekSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function WeekInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.WEEK, JobInputWeekSchemaType>) {
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
