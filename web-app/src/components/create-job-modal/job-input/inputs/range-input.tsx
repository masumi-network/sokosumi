import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { JobInputRangeSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function RangeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const { data } = jobInputSchema as JobInputRangeSchemaType;
  const transformedValidations = transformJobInputSchemaValidations(
    jobInputSchema as JobInputRangeSchemaType,
  );
  const min = Number(transformedValidations.min ?? 0);
  const max = Number(transformedValidations.max ?? 100);
  const step = Number(transformedValidations.step ?? data?.step ?? 1);
  const defaultValue = data?.default;

  const sliderValue =
    typeof field.value === "number"
      ? [field.value]
      : [Number(defaultValue ?? min)];
  const numberValue =
    typeof field.value === "number" ? field.value : Number(defaultValue ?? min);

  return (
    <div className="flex w-full flex-col gap-2">
      <Slider
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        className="pt-2 pb-4"
        onValueChange={(vals) => field.onChange(vals[0])}
      />
      <Input
        id={`${id}-range-number`}
        type="number"
        value={numberValue}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isNaN(next)) return;
          const clamped = Math.max(min, Math.min(max, next));
          field.onChange(clamped);
        }}
      />
    </div>
  );
}
