import type { InputDateSchemaType } from "@sokosumi/masumi/schemas";
import type { InputType } from "@sokosumi/masumi/types";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatDateValue,
  isDateValueOutOfBounds,
  normalizeDateValidationBound,
  parseDateValue,
} from "@/lib/job-input/date-value";

import type { JobInputComponentProps } from "./types";

export function DateInput({
  field,
  jobInputSchema,
  controlProps,
}: JobInputComponentProps<InputType.DATE, InputDateSchemaType>) {
  const selectedDate =
    typeof field.value === "string" ? parseDateValue(field.value) : undefined;

  const { minDateValue, maxDateValue } = useMemo(() => {
    const transformedValidations =
      transformJobInputSchemaValidations(jobInputSchema);
    const minDateValue = normalizeDateValidationBound(
      transformedValidations.min as string | number | undefined,
    );
    const maxDateValue = normalizeDateValidationBound(
      transformedValidations.max as string | number | undefined,
    );
    return { minDateValue, maxDateValue };
  }, [jobInputSchema]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          disabled={field.disabled}
          aria-describedby={controlProps?.["aria-describedby"]}
          aria-invalid={
            controlProps?.["aria-invalid"] === true ||
            controlProps?.["aria-invalid"] === "true"
          }
        >
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
          onSelect={(date) =>
            field.onChange(date ? formatDateValue(date) : null)
          }
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
  );
}
