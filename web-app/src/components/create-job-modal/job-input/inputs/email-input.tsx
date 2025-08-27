import { Input } from "@/components/ui/input";
import { JobInputEmailSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function EmailInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.EMAIL, JobInputEmailSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="email"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
