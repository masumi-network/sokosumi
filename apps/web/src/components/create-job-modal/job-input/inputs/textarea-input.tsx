import { InputTextareaSchemaType, InputType } from "@sokosumi/masumi/schemas";

import { Textarea } from "@/components/ui/textarea";

import { JobInputComponentProps } from "./types";

export function TextareaInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.TEXTAREA, InputTextareaSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Textarea
      id={id}
      placeholder={data?.placeholder ?? undefined}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
