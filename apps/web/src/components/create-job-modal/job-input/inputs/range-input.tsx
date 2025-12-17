import { InputRangeSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

import { JobInputComponentProps } from "./types";

export function RangeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.RANGE, InputRangeSchemaType>) {
  const { defaultValue, min, max, step } = useMemo(() => {
    const { data } = jobInputSchema;
    const transformedValidations =
      transformJobInputSchemaValidations(jobInputSchema);
    return {
      defaultValue: data?.default,
      min: Number(transformedValidations.min ?? 0),
      max: Number(transformedValidations.max ?? 100),
      step: Number(transformedValidations.step ?? data?.step ?? 1),
    };
  }, [jobInputSchema]);

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
