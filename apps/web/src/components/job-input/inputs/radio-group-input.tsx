import type { InputRadioGroupSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { JobInputComponentProps } from "./types";

export function RadioGroupInput({
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.RADIO_GROUP, InputRadioGroupSchemaType>) {
  const {
    data: { values },
  } = jobInputSchema;
  const selectedIndex = Array.isArray(field.value)
    ? ((field.value as number[])[0] ?? -1)
    : -1;

  return (
    <RadioGroup
      value={selectedIndex >= 0 ? String(selectedIndex) : ""}
      onValueChange={(val) => field.onChange([Number(val)])}
      disabled={field.disabled}
      aria-describedby={controlProps?.["aria-describedby"]}
      aria-invalid={controlProps?.["aria-invalid"]}
    >
      {values.map((label: string, idx: number) => (
        <label
          key={`${idx}-${label}`}
          className="flex cursor-pointer items-center gap-2"
        >
          <RadioGroupItem value={String(idx)} />
          <span>{label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}
