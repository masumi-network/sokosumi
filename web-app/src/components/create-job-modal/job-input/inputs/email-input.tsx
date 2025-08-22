import { Input } from "@/components/ui/input";
import { JobInputEmailSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function EmailInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputEmailSchemaType;
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
