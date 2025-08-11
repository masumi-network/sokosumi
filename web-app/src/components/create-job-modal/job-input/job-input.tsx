import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import MultipleSelect from "@/components/multiple-select";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import { isOptional, isSingleOption } from "./util";

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
            <InputField id={id} field={field} jobInputSchema={jobInputSchema} />
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
  id: string;
  jobInputSchema: JobInputSchemaType;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
}

function InputField({ id, field, jobInputSchema }: InputFieldProps) {
  const { type, data } = jobInputSchema;

  if (type === ValidJobInputTypes.STRING)
    return (
      <Input
        id={id}
        placeholder={data?.placeholder}
        type="text"
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
    );

  if (type === ValidJobInputTypes.TEXTAREA)
    return (
      <Textarea
        id={id}
        placeholder={data?.placeholder}
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
    );

  if (type === ValidJobInputTypes.NUMBER)
    return (
      <Input
        id={id}
        placeholder={data?.placeholder}
        type="number"
        {...field}
        value={Number(field.value).toString()}
      />
    );

  if (type === ValidJobInputTypes.BOOLEAN)
    return (
      <Switch
        id={id}
        checked={typeof field.value === "boolean" ? field.value : false}
        onCheckedChange={field.onChange}
        disabled={field.disabled}
      />
    );

  if (type === ValidJobInputTypes.OPTION) {
    const isSingle = isSingleOption(jobInputSchema);
    const {
      name,
      data: { values },
    } = jobInputSchema;

    if (isSingle) {
      return (
        <Select
          value={Array.isArray(field.value) ? values[field.value[0]] : ""}
          onValueChange={(value) => field.onChange([values.indexOf(value)])}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{name}</SelectLabel>
              {values.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    } else {
      return (
        <MultipleSelect
          name={name}
          value={
            Array.isArray(field.value)
              ? field.value.map((index) => values[index])
              : []
          }
          onChange={(optionValues) =>
            field.onChange(
              optionValues
                .map((optionValue) => values.indexOf(optionValue))
                .sort(),
            )
          }
          options={values}
          className="w-full"
        />
      );
    }
  }

  if (type === ValidJobInputTypes.NONE) return null;
}
