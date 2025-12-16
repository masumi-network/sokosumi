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

export function DateInput({
  field,
  jobInputSchema,
}: JobInputComponentProps<InputType.DATE, InputDateSchemaType>) {
  const selectedDate = field.value instanceof Date ? field.value : undefined;

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
