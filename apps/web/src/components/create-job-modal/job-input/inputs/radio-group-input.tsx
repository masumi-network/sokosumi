import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  JobInputRadioGroupSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function RadioGroupInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<
  ValidJobInputTypes.RADIO_GROUP,
  JobInputRadioGroupSchemaType
>) {
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
