import { InputRadioGroupSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { JobInputComponentProps } from "./types";

export function RadioGroupInput({
  field,
  jobInputSchema,
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
