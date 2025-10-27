import { Textarea } from "@/components/ui/textarea";
import {
  JobInputTextareaSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TextareaInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.TEXTAREA,
  JobInputTextareaSchemaType
>) {
  const { data } = jobInputSchema;

  return (
    <Textarea
      id={id}
      placeholder={data?.placeholder ?? undefined}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
