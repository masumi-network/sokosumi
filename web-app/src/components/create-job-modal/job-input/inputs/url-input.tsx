import { Input } from "@/components/ui/input";
import { JobInputUrlSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function UrlInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputUrlSchemaType;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="url"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
