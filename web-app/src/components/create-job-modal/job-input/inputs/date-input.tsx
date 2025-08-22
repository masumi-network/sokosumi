import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { JobInputDateSchemaType } from "@/lib/job-input";
import { parseDate } from "@/lib/utils";

import { JobInputComponentProps } from "./types";

export function DateInput({
  id: _id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const selectedDate: Date | undefined =
    field.value instanceof Date ? (field.value as Date) : undefined;
  const transformedValidations = transformJobInputSchemaValidations(
    jobInputSchema as JobInputDateSchemaType,
  );
  const minDate = parseDate(
    transformedValidations.min as string | number | undefined,
  );
  const maxDate = parseDate(
    transformedValidations.max as string | number | undefined,
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          {selectedDate
            ? selectedDate.toLocaleDateString()
            : ((jobInputSchema as JobInputDateSchemaType).data?.placeholder ??
              "Pick a date")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(d) => field.onChange(d ?? null)}
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
