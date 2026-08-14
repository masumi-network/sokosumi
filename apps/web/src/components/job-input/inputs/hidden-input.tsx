import type { InputHiddenSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import type { JobInputComponentProps } from "./types";

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
