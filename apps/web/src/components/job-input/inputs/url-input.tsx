import type { InputUrlSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import type { JobInputComponentProps } from "./types";

export function UrlInput({
  id,
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<typeof InputType.URL, InputUrlSchemaType>) {
  const { data } = jobInputSchema;

  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="url"
      {...field}
      {...controlProps}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
