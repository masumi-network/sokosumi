import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import { JobInputsFormSchemaType } from "@/lib/job-input";

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
  TextInput,
  TimeInput,
  UrlInput,
  WeekInput,
} from "./index";

interface InputFieldProps {
  id: string;
  jobInputSchema: InputFieldSchemaType;
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
    case InputType.TEXT:
      return (
        <TextInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.STRING:
      return (
        <StringInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.TEL:
      return (
        <TelInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.EMAIL:
      return (
        <EmailInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.URL:
      return (
        <UrlInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.SEARCH:
      return (
        <SearchInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.PASSWORD:
      return (
        <PasswordInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.TEXTAREA:
      return (
        <TextareaInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.COLOR:
      return (
        <ColorInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.NUMBER:
      return (
        <NumberInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.BOOLEAN:
      return (
        <BooleanInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.CHECKBOX:
      return (
        <CheckboxInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.OPTION:
      return (
        <OptionInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.MULTISELECT:
      return (
        <MultiselectInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.RADIO_GROUP:
      return (
        <RadioGroupInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.FILE:
      return (
        <FileInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.DATE:
      return (
        <DateInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.DATETIME:
      return (
        <DatetimeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.TIME:
      return (
        <TimeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.MONTH:
      return (
        <MonthInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.WEEK:
      return (
        <WeekInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.RANGE:
      return (
        <RangeInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.HIDDEN:
      return (
        <HiddenInput
          id={id}
          field={field}
          jobInputSchema={jobInputSchema}
          form={form}
        />
      );
    case InputType.NONE:
      return null;
    default:
      return null;
  }
}
