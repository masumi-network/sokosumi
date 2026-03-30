import type { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { JobInputsFormSchemaType } from "@/lib/job-input";

import { InputField } from "./inputs/input-field";
import { isOptional } from "./util";

interface JobInputProps {
  form: UseFormReturn<JobInputsFormSchemaType>;
  jobInputSchema: InputFieldSchemaType;
  disabled?: boolean;
}

export default function JobInput({
  form,
  jobInputSchema,
  disabled = false,
}: JobInputProps) {
  const { id, name, data } = jobInputSchema;
  return (
    <FormField
      control={form.control}
      name={id}
      disabled={disabled}
      render={({ field }) => (
        <FormItem>
          {jobInputSchema.type !== InputType.HIDDEN && (
            <FormLabel htmlFor={id}>{`${name} ${
              isOptional(jobInputSchema) ? "" : "*"
            }`}</FormLabel>
          )}
          <FormControl>
            <InputField
              id={id}
              field={field}
              jobInputSchema={jobInputSchema}
              form={form}
            />
          </FormControl>
          {jobInputSchema.type !== InputType.HIDDEN &&
            jobInputSchema.type !== InputType.NONE &&
            data?.description && (
              <FormDescription>{data.description}</FormDescription>
            )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
