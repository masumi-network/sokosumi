import { Textarea } from "@/components/ui/textarea";
import { JobInputTextareaSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TextareaInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputTextareaSchemaType;
  return (
    <Textarea
      id={id}
      placeholder={data?.placeholder}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
