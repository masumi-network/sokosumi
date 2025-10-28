import { Input } from "@/components/ui/input";
import { JobInputTextSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TextInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.TEXT, JobInputTextSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="text"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
