import { InputDateSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { parseDate } from "@/lib/utils";

import { JobInputComponentProps } from "./types";

const DATE_VALUE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function parseDateValue(value: unknown): Date | undefined {
  if (typeof value !== "string" || !DATE_VALUE_REGEX.test(value)) {
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

function formatDateValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DateInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.DATE, InputDateSchemaType>) {
  const selectedDate = parseDateValue(field.value);

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
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          {selectedDate
            ? selectedDate.toLocaleDateString()
            : ((jobInputSchema as InputDateSchemaType).data?.placeholder ??
              "Pick a date")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => field.onChange(date ? formatDateValue(date) : null)}
          disabled={(date) =>
            (minDate ? date < minDate : false) ||
            (maxDate ? date > maxDate : false)
          }
          captionLayout="dropdown"
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
