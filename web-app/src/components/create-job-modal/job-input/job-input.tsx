import { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { JobInputSchemaType, JobInputsFormSchemaType } from "@/lib/job-input";

import { InputField } from "./inputs/input-field";
import { isOptional } from "./util";

interface JobInputProps {
  form: UseFormReturn<JobInputsFormSchemaType>;
  jobInputSchema: JobInputSchemaType;
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
          <FormLabel
            htmlFor={id}
          >{`${name} ${isOptional(jobInputSchema) ? "" : "*"}`}</FormLabel>
          <FormControl>
            <InputField
              id={id}
              field={field}
              jobInputSchema={jobInputSchema}
              form={form}
            />
          </FormControl>
          {data?.description && (
            <FormDescription>{data.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// InputField moved to ./inputs/input-field
