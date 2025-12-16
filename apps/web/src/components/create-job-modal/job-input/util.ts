import {
  InputFileSchemaType,
  InputOptionSchemaType,
  InputSchemaType,
  ValidationSchemaType,
} from "@sokosumi/masumi/schemas";
import { InputType, InputValidation } from "@sokosumi/masumi/types";

export const isOptional = (jobInputSchema: InputSchemaType): boolean => {
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
  const { validations } = jobInputOptionSchema;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === InputValidation.MAX && Number(value) <= 1,
  );
};

export const transformJobInputSchemaValidations = <T extends InputSchemaType>(
  jobInputSchema: T extends {
    validations?: ValidationSchemaType[] | null | undefined;
  }
    ? T
    : never,
): Partial<Record<InputValidation, string | number>> => {
  const { validations } = jobInputSchema as {
    validations?: {
      validation: InputValidation;
      value: string | number;
    }[];
  };
  return (validations ?? []).reduce(
    (acc, cur) => {
      acc[cur.validation] = cur.value;
      return acc;
    },
    {} as Partial<Record<InputValidation, string | number>>,
  );
};

export const transformJobInputFileSchema = (
  jobInputSchema: InputFileSchemaType,
): Record<InputValidation, string | number> => {
  const v = transformJobInputSchemaValidations(jobInputSchema) as Record<
    InputValidation,
    string | number
  >;
  return v;
};
