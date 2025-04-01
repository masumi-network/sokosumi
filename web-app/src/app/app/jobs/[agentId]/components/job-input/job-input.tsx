import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { isOptional } from "./util";

interface JobInputProps {
  form: UseFormReturn<JobInputsFormSchemaType>;
  jobInputSchema: JobInputSchemaType;
}

export default function JobInput({ form, jobInputSchema }: JobInputProps) {
  const { id, name, data } = jobInputSchema;

  return (
    <FormField
      control={form.control}
      name={id}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{`${name} ${isOptional(jobInputSchema) ? "" : "*"}`}</FormLabel>
          <FormControl>
            <InputField field={field} jobInputSchema={jobInputSchema} />
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

interface InputFieldProps {
  jobInputSchema: JobInputSchemaType;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
}

function InputField({ field, jobInputSchema }: InputFieldProps) {
  const { type, data } = jobInputSchema;

  if (type === ValidJobInputTypes.STRING)
    return (
      <Input
        placeholder={data?.placeholder}
        type="text"
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
    );

  if (type === ValidJobInputTypes.NUMBER)
    return (
      <Input
        placeholder={data?.placeholder}
        type="number"
        {...field}
        value={Number(field.value).toString()}
      />
    );

  if (type === ValidJobInputTypes.BOOLEAN)
    return (
      <Switch
        checked={typeof field.value === "boolean" ? field.value : false}
        onCheckedChange={field.onChange}
        disabled={field.disabled}
      />
    );

  if (type === ValidJobInputTypes.OPTION) return null;

  if (type === ValidJobInputTypes.NONE) return null;
}
