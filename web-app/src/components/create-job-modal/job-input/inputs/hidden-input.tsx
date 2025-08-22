import { JobInputComponentProps } from "./types";

export function HiddenInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const data = (jobInputSchema.data as { value?: string } | undefined) ?? {};
  const value =
    typeof field.value === "string" ? field.value : (data.value ?? "");
  return (
    <input id={id} type="hidden" value={value} onChange={field.onChange} />
  );
}
