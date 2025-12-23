import { InputFieldSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { ComponentType } from "react";
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
  JobInputComponentProps,
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

type InputComponent = ComponentType<
  JobInputComponentProps<InputType, InputFieldSchemaType>
>;

const INPUT_COMPONENT_REGISTRY: Partial<Record<InputType, InputComponent>> = {
  [InputType.TEXT]: TextInput as InputComponent,
  [InputType.STRING]: StringInput as InputComponent,
  [InputType.TEL]: TelInput as InputComponent,
  [InputType.EMAIL]: EmailInput as InputComponent,
  [InputType.URL]: UrlInput as InputComponent,
  [InputType.SEARCH]: SearchInput as InputComponent,
  [InputType.PASSWORD]: PasswordInput as InputComponent,
  [InputType.TEXTAREA]: TextareaInput as InputComponent,
  [InputType.COLOR]: ColorInput as InputComponent,
  [InputType.NUMBER]: NumberInput as InputComponent,
  [InputType.BOOLEAN]: BooleanInput as InputComponent,
  [InputType.CHECKBOX]: CheckboxInput as InputComponent,
  [InputType.OPTION]: OptionInput as InputComponent,
  [InputType.MULTISELECT]: MultiselectInput as InputComponent,
  [InputType.RADIO_GROUP]: RadioGroupInput as InputComponent,
  [InputType.FILE]: FileInput as InputComponent,
  [InputType.DATE]: DateInput as InputComponent,
  [InputType.DATETIME]: DatetimeInput as InputComponent,
  [InputType.TIME]: TimeInput as InputComponent,
  [InputType.MONTH]: MonthInput as InputComponent,
  [InputType.WEEK]: WeekInput as InputComponent,
  [InputType.RANGE]: RangeInput as InputComponent,
  [InputType.HIDDEN]: HiddenInput as InputComponent,
};

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

  if (type === InputType.NONE) {
    return null;
  }

  const Component = INPUT_COMPONENT_REGISTRY[type];

  if (!Component) {
    return null;
  }

  return (
    <Component
      id={id}
      field={field}
      jobInputSchema={jobInputSchema}
      form={form}
    />
  );
}
