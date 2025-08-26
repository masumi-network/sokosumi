import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import {
  BooleanInput,
  CheckboxInput,
  ColorInput,
  DateInput,
  DatetimeInput,
  EmailInput,
  FileInput,
  HiddenInput,
  MonthInput,
  MultiselectInput,
  NumberInput,
  OptionInput,
  PasswordInput,
  RadioGroupInput,
  RangeInput,
  SearchInput,
  StringInput,
  TelInput,
  TextareaInput,
  TimeInput,
  UrlInput,
  WeekInput,
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
    case ValidJobInputTypes.TEL:
      return (
        <TelInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.EMAIL:
      return (
        <EmailInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.URL:
      return (
        <UrlInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.SEARCH:
      return (
        <SearchInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.PASSWORD:
      return (
        <PasswordInput
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
    case ValidJobInputTypes.COLOR:
      return (
        <ColorInput
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
    case ValidJobInputTypes.CHECKBOX:
      return (
        <CheckboxInput
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
    case ValidJobInputTypes.MULTISELECT:
      return (
        <MultiselectInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.RADIO_GROUP:
      return (
        <RadioGroupInput
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
    case ValidJobInputTypes.DATE:
      return (
        <DateInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.DATETIME:
      return (
        <DatetimeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.TIME:
      return (
        <TimeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.MONTH:
      return (
        <MonthInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.WEEK:
      return (
        <WeekInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.RANGE:
      return (
        <RangeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case ValidJobInputTypes.HIDDEN:
      return (
        <HiddenInput
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
