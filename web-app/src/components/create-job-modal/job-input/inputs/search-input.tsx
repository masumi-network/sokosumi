import { Input } from "@/components/ui/input";
import { JobInputSearchSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function SearchInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.SEARCH,
  JobInputSearchSchemaType
>) {
  const { data } = jobInputSchema;
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
