import {
  JobInputFileSchemaType,
  JobInputOptionSchemaType,
  JobInputSchemaType,
  ValidationSchemaType,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "@/lib/job-input";

export const isOptional = (jobInputSchema: JobInputSchemaType): boolean => {
  const { type } = jobInputSchema;
  if (type === ValidJobInputTypes.NONE) return true;

  const validations = jobInputSchema.validations;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === ValidJobInputValidationTypes.OPTIONAL && value === "true",
  );
};

export const isSingleOption = (
  jobInputOptionSchema: JobInputOptionSchemaType,
): boolean => {
  const { validations } = jobInputOptionSchema;
  if (!validations) return false;

  return validations.some(
    ({ validation, value }) =>
      validation === ValidJobInputValidationTypes.MAX && Number(value) <= 1,
  );
};

export const transformJobInputSchemaValidations = <
  T extends JobInputSchemaType,
>(
  jobInputSchema: T extends {
    validations?: ValidationSchemaType[] | null | undefined;
  }
    ? T
    : never,
): Partial<Record<ValidJobInputValidationTypes, string | number>> => {
  const { validations } = jobInputSchema as {
    validations?: {
      validation: ValidJobInputValidationTypes;
      value: string | number;
    }[];
  };
  return (validations ?? []).reduce(
    (acc, cur) => {
      acc[cur.validation] = cur.value;
      return acc;
    },
    {} as Partial<Record<ValidJobInputValidationTypes, string | number>>,
  );
};

export const transformJobInputFileSchema = (
  jobInputSchema: JobInputFileSchemaType,
): Record<ValidJobInputValidationTypes, string | number> => {
  const v = transformJobInputSchemaValidations(jobInputSchema) as Record<
    ValidJobInputValidationTypes,
    string | number
  >;
  return v;
};
