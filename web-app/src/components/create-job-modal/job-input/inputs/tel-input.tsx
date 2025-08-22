import { Input } from "@/components/ui/input";
import { JobInputTelSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function TelInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputTelSchemaType;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="tel"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
