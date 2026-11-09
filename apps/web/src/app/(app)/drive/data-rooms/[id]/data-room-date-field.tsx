"use client";

import { CalendarIcon, X } from "lucide-react";
import { useFormatter } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * A day, or none. Stored as the end of that day in the viewer's time zone,
 * so "until 30 Nov" still lets people in on the 30th.
 */
export function DataRoomDateField({
  id,
  value,
  placeholder,
  clearLabel,
  onChange,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string | null) => void;
}) {
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : undefined;

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="justify-start gap-2 font-normal"
          >
            <CalendarIcon aria-hidden className="size-4" />
            {selected
              ? format.dateTime(selected, { dateStyle: "medium" })
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            disabled={{ before: new Date() }}
            onSelect={(day) => {
              if (!day) return;
              const end = new Date(day);
              end.setHours(23, 59, 59, 0);
              onChange(end.toISOString());
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel}
          onClick={() => onChange(null)}
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
