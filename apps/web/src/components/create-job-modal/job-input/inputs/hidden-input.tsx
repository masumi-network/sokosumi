import { InputHiddenSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { JobInputComponentProps } from "./types";

export function HiddenInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.HIDDEN, InputHiddenSchemaType>) {
  const value =
    typeof field.value === "string"
      ? field.value
      : (jobInputSchema.data?.value ?? "");

  return (
    <input id={id} type="hidden" value={value} onChange={field.onChange} />
  );
}
