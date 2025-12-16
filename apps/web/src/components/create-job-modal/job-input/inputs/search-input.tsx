import { InputSearchSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { Input } from "@/components/ui/input";

import { JobInputComponentProps } from "./types";

export function SearchInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.SEARCH, InputSearchSchemaType>) {
  const { data } = jobInputSchema;
  return (
    <Input
      id={id}
      placeholder={data?.placeholder ?? undefined}
      type="search"
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
