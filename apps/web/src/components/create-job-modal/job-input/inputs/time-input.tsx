import { Input } from "@/components/ui/input";
import { JobInputTimeSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.TIME, JobInputTimeSchemaType>) {
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
