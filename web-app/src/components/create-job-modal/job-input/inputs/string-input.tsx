import { Input } from "@/components/ui/input";
import { JobInputStringSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function StringInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputStringSchemaType;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="text"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
