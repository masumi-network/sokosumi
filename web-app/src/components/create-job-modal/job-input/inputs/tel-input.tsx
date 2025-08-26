import { Input } from "@/components/ui/input";
import { JobInputTelSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TelInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.TEL, JobInputTelSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="tel"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
