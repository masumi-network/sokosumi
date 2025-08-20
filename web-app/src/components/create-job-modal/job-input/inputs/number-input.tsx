import { Input } from "@/components/ui/input";
import { JobInputNumberSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function NumberInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputNumberSchemaType;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder}
      type="number"
      {...field}
      value={Number(field.value).toString()}
    />
  );
}
