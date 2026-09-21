import type { InputTextareaSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Textarea } from "@/components/ui/textarea";

import type { JobInputComponentProps } from "./types";

export function TextareaInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<typeof InputType.TEXTAREA, InputTextareaSchemaType>) {
  const { data } = jobInputSchema;
  const defaultValue = data?.default ?? "";

  return (
    <Textarea
      id={id}
      placeholder={data?.placeholder ?? undefined}
      {...field}
      {...controlProps}
      value={typeof field.value === "string" ? field.value : defaultValue}
    />
  );
}
