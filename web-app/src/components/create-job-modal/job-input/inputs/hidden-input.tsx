import { JobInputHiddenSchemaType, ValidJobInputTypes } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function HiddenInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.HIDDEN,
  JobInputHiddenSchemaType
>) {
  const value =
    typeof field.value === "string"
      ? field.value
      : (jobInputSchema.data?.value ?? "");

  return (
    <input id={id} type="hidden" value={value} onChange={field.onChange} />
  );
}
