import type { InputDatetimeSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DATETIME_LOCAL_VALUE_REGEX,
  formatDateValue,
  isDateValueOutOfBounds,
  normalizeDatetimeLocalValidationBound,
  parseDateValue,
  TIME_VALUE_REGEX,
} from "@/lib/job-input/date-value";

import type { JobInputComponentProps } from "./types";

export function DatetimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.DATETIME, InputDatetimeSchemaType>) {
  const valueString =
    typeof field.value === "string" &&
    DATETIME_LOCAL_VALUE_REGEX.test(field.value)
      ? field.value
      : "";
  const [datePart, timePart] = valueString.split("T");
  const valueDate = datePart ? parseDateValue(datePart) : undefined;
  const timeString =
    typeof timePart === "string" && TIME_VALUE_REGEX.test(timePart)
      ? timePart
      : "";

  const handleSelectDate = (d?: Date) => {
    if (!d) return field.onChange(null);
    const nextDatePart = formatDateValue(d);
    const nextTimePart = timeString || "00:00";
    field.onChange(`${nextDatePart}T${nextTimePart}`);
  };

  const handleTimeChange = (v: string) => {
    const nextTimePart = TIME_VALUE_REGEX.test(v) ? v : "00:00";
    const baseDatePart = datePart || formatDateValue(new Date());
    field.onChange(`${baseDatePart}T${nextTimePart}`);
  };

  const { minDateValue, maxDateValue } = useMemo(() => {
    const transformedValidations =
      transformJobInputSchemaValidations(jobInputSchema);
    const minDateTimeValue = normalizeDatetimeLocalValidationBound(
      transformedValidations.min as string | number | undefined,
    );
    const maxDateTimeValue = normalizeDatetimeLocalValidationBound(
      transformedValidations.max as string | number | undefined,
    );

    return {
      minDateValue: minDateTimeValue?.split("T")[0],
      maxDateValue: maxDateTimeValue?.split("T")[0],
    };
  }, [jobInputSchema]);

  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start">
            {valueDate
              ? valueDate.toLocaleDateString()
              : ((jobInputSchema as InputDatetimeSchemaType).data
                  ?.placeholder ?? "Pick date & time")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <Calendar
            mode="single"
            selected={valueDate}
            onSelect={handleSelectDate}
            disabled={(date) => {
              const dateValue = formatDateValue(date);
              return isDateValueOutOfBounds(dateValue, {
                min: minDateValue,
                max: maxDateValue,
              });
            }}
            captionLayout="dropdown"
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        id={`${id}-time`}
        type="time"
        value={timeString}
        onChange={(e) => handleTimeChange(e.target.value)}
      />
    </div>
  );
}
