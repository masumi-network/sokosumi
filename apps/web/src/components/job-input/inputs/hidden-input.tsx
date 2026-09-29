import type { InputHiddenSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import type { JobInputComponentProps } from "./types";

export function HiddenInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<typeof InputType.HIDDEN, InputHiddenSchemaType>) {
  const value =
    typeof field.value === "string"
      ? field.value
      : (jobInputSchema.data?.value ?? "");

  return (
    <input id={id} type="hidden" value={value} onChange={field.onChange} />
  );
}
