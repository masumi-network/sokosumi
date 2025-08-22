import { Input } from "@/components/ui/input";
import { JobInputSearchSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function SearchInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputSearchSchemaType;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="search"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
