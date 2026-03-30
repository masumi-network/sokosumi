import type {
  InputFieldSchemaType,
  InputOptionSchemaType,
  ValidationSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";

import { getOptionSelectMode } from "@/lib/job-input/option-select-mode";

export const isOptional = (jobInputSchema: InputFieldSchemaType): boolean => {
  const { type } = jobInputSchema;
  if (type === InputType.NONE) return true;

  const validations = jobInputSchema.validations;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === InputValidation.OPTIONAL && value === "true",
  );
};

export const isSingleOption = (
  jobInputOptionSchema: InputOptionSchemaType,
): boolean => {
  return getOptionSelectMode(jobInputOptionSchema.validations) === "single";
};

export const transformJobInputSchemaValidations = <
  T extends InputFieldSchemaType,
>(
  jobInputSchema: T extends {
    validations?: ValidationSchemaType[] | null | undefined;
  }
    ? T
    : never,
): Partial<Record<InputValidation, string | number | boolean>> => {
  const { validations } = jobInputSchema as {
    validations?: {
      validation: InputValidation;
      value: string | number | boolean;
    }[];
  };
  return (validations ?? []).reduce(
    (acc, cur) => {
      acc[cur.validation] = cur.value;
      return acc;
    },
    {} as Partial<Record<InputValidation, string | number | boolean>>,
  );
};
