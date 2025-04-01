import { z } from "zod";

import {
  JobInputBooleanSchemaType,
  JobInputSchemaType,
  JobInputStringSchemaType,
} from "./job-input";
import {
  JobInputFormIntlPath,
  ValidJobInputFormatValues,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "./type";
import { allowEmptyString } from "./util";

export const makeZodSchemaFromJobInputSchema = (
  jobInputSchema: JobInputSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  switch (jobInputSchema.type) {
    case ValidJobInputTypes.String:
      return makeZodSchemaFromJobInputStringSchema(jobInputSchema, t);
    case ValidJobInputTypes.Boolean:
      return makeZodSchemaFromJobInputBooleanSchema(jobInputSchema, t);
  }
};

const makeZodSchemaFromJobInputStringSchema = (
  jobInputStringSchema: JobInputStringSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputStringSchema;
  if (!validations)
    return z.string({
      message: t?.("String.required", { name }),
    });

  let canBeOptional: boolean = false;
  const schema = validations.reduce(
    (acc, cur) => {
      const { validation, value } = cur;
      switch (validation) {
        case ValidJobInputValidationTypes.Min:
          return acc.min(value, {
            message: t?.("String.min", { name, value }),
          });
        case ValidJobInputValidationTypes.Max:
          return acc.max(value, {
            message: t?.("String.max", { name, value }),
          });
        case ValidJobInputValidationTypes.Format:
          switch (value) {
            case ValidJobInputFormatValues.Url:
              return acc.url({
                message: t?.("String.format", { name, value }),
              });
            case ValidJobInputFormatValues.Email:
              return acc.email({
                message: t?.("String.format", { name, value }),
              });
            case ValidJobInputFormatValues.Nonempty:
              return acc.min(1, {
                message: t?.("String.format", { name, value }),
              });
            default:
              return acc;
          }
        case ValidJobInputValidationTypes.Required:
          canBeOptional = value === "false";
          return acc;
      }
    },
    z.string({ message: t?.("String.required", { name }) }),
  );

  return canBeOptional ? allowEmptyString(schema) : schema;
};

// For Boolean Schema we can ignore validations
// because validations are only Required
// for UI, we will set default to `false`
// so undefined is not the case
const makeZodSchemaFromJobInputBooleanSchema = (
  jobInputSchema: JobInputBooleanSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name } = jobInputSchema;
  return z.boolean({
    message: t?.("Boolean.required", { name }),
  });
};
