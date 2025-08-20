import {
  JobInputFileSchemaType,
  JobInputOptionSchemaType,
  JobInputSchemaType,
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
      validation === ValidJobInputValidationTypes.MAX && value <= 1,
  );
};

export const transformJobInputFileSchema = (
  jobInputFileSchema: JobInputFileSchemaType,
): Record<ValidJobInputValidationTypes, string | number> => {
  const { validations } = jobInputFileSchema;
  const validationObject = validations.reduce(
    (acc, cur) => {
      acc[cur.validation] = cur.value;
      return acc;
    },
    {} as Record<ValidJobInputValidationTypes, string | number>,
  );

  return validationObject;
};
