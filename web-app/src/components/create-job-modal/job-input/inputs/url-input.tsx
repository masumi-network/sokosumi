import { Input } from "@/components/ui/input";
import { JobInputUrlSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function UrlInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<ValidJobInputTypes.URL, JobInputUrlSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="url"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
