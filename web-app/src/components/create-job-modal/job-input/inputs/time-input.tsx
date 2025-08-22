import { Input } from "@/components/ui/input";
import { JobInputTimeSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputTimeSchemaType;
  return (
    <Input
      id={id}
      type="time"
      placeholder={data?.placeholder}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
