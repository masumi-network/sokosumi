import { Input } from "@/components/ui/input";
import { JobInputWeekSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function WeekInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputWeekSchemaType;
  return (
    <Input
      id={id}
      type="week"
      placeholder={data?.placeholder}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
