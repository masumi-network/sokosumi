import { Textarea } from "@/components/ui/textarea";
import {
  JobInputSearchSchemaType,
  JobInputStringSchemaType,
  JobInputTextareaSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";
import { cn } from "@/lib/utils";

import { JobInputComponentProps } from "./types";

interface InputGroupTextareaInputProps
  extends JobInputComponentProps<
    | ValidJobInputTypes.TEXTAREA
    | ValidJobInputTypes.STRING
    | ValidJobInputTypes.SEARCH,
    | JobInputTextareaSchemaType
    | JobInputStringSchemaType
    | JobInputSearchSchemaType
  > {
  className?: string;
}

export function InputGroupTextareaInput({
  id,
  field,
  jobInputSchema,
  className,
}: InputGroupTextareaInputProps) {
  const { data } = jobInputSchema;

  return (
    <Textarea
      id={id}
      placeholder={data?.placeholder ?? undefined}
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
        className,
      )}
      {...field}
      value={typeof field.value === "string" ? field.value : ""}
    />
  );
}
