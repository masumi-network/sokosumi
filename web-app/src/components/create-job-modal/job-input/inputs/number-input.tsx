import { Input } from "@/components/ui/input";
import { JobInputNumberSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function NumberInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.NUMBER,
  JobInputNumberSchemaType
>) {
  const { data } = jobInputSchema;

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
