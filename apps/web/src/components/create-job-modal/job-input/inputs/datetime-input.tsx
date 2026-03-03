import { InputDatetimeSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { parseDate } from "@/lib/utils";

import { JobInputComponentProps } from "./types";

const DATE_VALUE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME_LOCAL_VALUE_REGEX =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/;

function parseDatePart(value: string): Date | undefined {
  if (!DATE_VALUE_REGEX.test(value)) {
    return undefined;
  }

  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  return parsed;
}

function formatDatePart(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatetimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.DATETIME, InputDatetimeSchemaType>) {
  const valueString =
    typeof field.value === "string" && DATETIME_LOCAL_VALUE_REGEX.test(field.value)
      ? field.value
      : "";
  const [datePart, timePart] = valueString.split("T");
  const valueDate = datePart ? parseDatePart(datePart) : undefined;
  const timeString =
    typeof timePart === "string" && TIME_VALUE_REGEX.test(timePart)
      ? timePart
      : "";

  const handleSelectDate = (d?: Date) => {
    if (!d) return field.onChange(null);
    const nextDatePart = formatDatePart(d);
    const nextTimePart = timeString || "00:00";
    field.onChange(`${nextDatePart}T${nextTimePart}`);
  };

  const handleTimeChange = (v: string) => {
    const nextTimePart = TIME_VALUE_REGEX.test(v) ? v : "00:00";
    const baseDatePart = datePart || formatDatePart(new Date());
    field.onChange(`${baseDatePart}T${nextTimePart}`);
  };

  const { minDate, maxDate } = useMemo(() => {
    const transformedValidations =
      transformJobInputSchemaValidations(jobInputSchema);
    const minDate = parseDate(
      transformedValidations.min as string | number | undefined,
    );
    const maxDate = parseDate(
      transformedValidations.max as string | number | undefined,
    );
    return { minDate, maxDate };
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
            disabled={(date) =>
              (minDate ? date < minDate : false) ||
              (maxDate ? date > maxDate : false)
            }
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
