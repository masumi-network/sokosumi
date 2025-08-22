import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { JobInputDatetimeSchemaType } from "@/lib/job-input";
import { parseDate } from "@/lib/utils";

import { JobInputComponentProps } from "./types";

export function DatetimeInput({
  id,
  field,
  jobInputSchema,
}: JobInputComponentProps) {
  const valueDate: Date | undefined =
    field.value instanceof Date ? (field.value as Date) : undefined;
  const timeString = valueDate
    ? `${String(valueDate.getHours()).padStart(2, "0")}:${String(valueDate.getMinutes()).padStart(2, "0")}`
    : "";

  const handleSelectDate = (d?: Date) => {
    if (!d) return field.onChange(null);
    const next = new Date(d);
    if (valueDate) {
      next.setHours(valueDate.getHours());
      next.setMinutes(valueDate.getMinutes());
      next.setSeconds(0, 0);
    }
    field.onChange(next);
  };

  const handleTimeChange = (v: string) => {
    const [hh, mm] = v.split(":").map((n) => Number(n));
    const base = valueDate ?? new Date();
    const next = new Date(base);
    next.setHours(Number.isFinite(hh) ? hh : 0);
    next.setMinutes(Number.isFinite(mm) ? mm : 0);
    next.setSeconds(0, 0);
    field.onChange(next);
  };

  const transformedValidations = transformJobInputSchemaValidations(
    jobInputSchema as JobInputDatetimeSchemaType,
  );
  const minDate = parseDate(
    transformedValidations.min as string | number | undefined,
  );
  const maxDate = parseDate(
    transformedValidations.max as string | number | undefined,
  );

  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start">
            {valueDate
              ? valueDate.toLocaleDateString()
              : ((jobInputSchema as JobInputDatetimeSchemaType).data
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
