import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import {
  BooleanInput,
  FileInput,
  NumberInput,
  OptionInput,
  StringInput,
  TextareaInput,
} from "./index";

interface InputFieldProps {
  id: string;
  jobInputSchema: JobInputSchemaType;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}

export function InputField({
  id,
  field,
  jobInputSchema,
  form,
}: InputFieldProps) {
  const { type } = jobInputSchema;

  switch (type) {
    case ValidJobInputTypes.STRING:
      return (
        <StringInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.TEXTAREA:
      return (
        <TextareaInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.NUMBER:
      return (
        <NumberInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.BOOLEAN:
      return (
        <BooleanInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.OPTION:
      return (
        <OptionInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.FILE:
      return (
        <FileInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.NONE:
      return null;
    default:
      return null;
  }
}
