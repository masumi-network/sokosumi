import { z } from "zod";

import {
  JobInputBooleanSchemaType,
  JobInputNumberSchemaType,
  JobInputOptionSchemaType,
  JobInputSchemaType,
  JobInputStringSchemaType,
} from "./job-input";
import {
  JobInputFormIntlPath,
  ValidJobInputFormatValues,
  ValidJobInputTypes,
  ValidJobInputValidationTypes,
} from "./type";

export const makeZodSchemaFromJobInputSchema = (
  jobInputSchema: JobInputSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  switch (jobInputSchema.type) {
    case ValidJobInputTypes.STRING:
      return makeZodSchemaFromJobInputStringSchema(jobInputSchema, t);
    case ValidJobInputTypes.NUMBER:
      return makeZodSchemaFromJobInputNumberSchema(jobInputSchema, t);
    case ValidJobInputTypes.BOOLEAN:
      return makeZodSchemaFromJobInputBooleanSchema(jobInputSchema, t);
    case ValidJobInputTypes.OPTION:
      return makeZodSchemaFromJobInputOptionSchema(jobInputSchema, t);
    case ValidJobInputTypes.NONE:
      return z.never().nullable();
  }
};

const makeZodSchemaFromJobInputStringSchema = (
  jobInputStringSchema: JobInputStringSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputStringSchema;
  const defaultSchema = z.string({
    message: t?.("String.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case ValidJobInputValidationTypes.MIN:
        return acc.min(value, {
          message: t?.("String.min", { name, value }),
        });
      case ValidJobInputValidationTypes.MAX:
        return acc.max(value, {
          message: t?.("String.max", { name, value }),
        });
      case ValidJobInputValidationTypes.FORMAT:
        switch (value) {
          case ValidJobInputFormatValues.URL:
            return acc.url({
              message: t?.("String.format", { name, value }),
            });
          case ValidJobInputFormatValues.EMAIL:
            return acc.email({
              message: t?.("String.format", { name, value }),
            });
          case ValidJobInputFormatValues.NON_EMPTY:
            return acc.min(1, {
              message: t?.("String.format", { name, value }),
            });
          default:
            return acc;
        }
      case ValidJobInputValidationTypes.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullable() : schema;
};

const makeZodSchemaFromJobInputNumberSchema = (
  jobInputNumberSchema: JobInputNumberSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const { name, validations } = jobInputNumberSchema;
  const defaultSchema = z.number({
    coerce: true,
    message: t?.("Number.required", { name }),
    required_error: t?.("Number.required", { name }),
    invalid_type_error: t?.("Number.required", { name }),
  });
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case ValidJobInputValidationTypes.MIN:
        return acc.min(value, {
          message: t?.("Number.min", { name, value }),
        });
      case ValidJobInputValidationTypes.MAX:
        return acc.max(value, {
          message: t?.("Number.max", { name, value }),
        });
      case ValidJobInputValidationTypes.FORMAT:
        switch (value) {
          case ValidJobInputFormatValues.INTEGER:
            return acc.int({
              message: t?.("Number.format", { name, value }),
            });
          default:
            return acc;
        }
      case ValidJobInputValidationTypes.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullable() : schema;
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

const makeZodSchemaFromJobInputOptionSchema = (
  jobInputOptionSchema: JobInputOptionSchemaType,
  t?: IntlTranslation<JobInputFormIntlPath>,
) => {
  const {
    name,
    data: { values },
    validations,
  } = jobInputOptionSchema;
  const defaultSchema = z.array(
    z
      .number()
      .int({
        message: t?.("Option.integer", { name }),
      })
      .nonnegative({
        message: t?.("Option.nonnegative", { name }),
      })
      .max(values.length - 1, {
        message: t?.("Option.invalid", { name, maxValue: values.length - 1 }),
      }),
    { message: t?.("Option.required", { name }) },
  );
  if (!validations) return defaultSchema;

  let canBeOptional: boolean = false;
  const schema = validations.reduce((acc, cur) => {
    const { validation, value } = cur;
    switch (validation) {
      case ValidJobInputValidationTypes.MIN:
        return acc.min(value, {
          message: t?.("Option.min", { name, value }),
        });
      case ValidJobInputValidationTypes.MAX:
        return acc.max(value, {
          message: t?.("Option.max", { name, value }),
        });
      case ValidJobInputValidationTypes.OPTIONAL:
        canBeOptional = value === "true";
        return acc;
    }
  }, defaultSchema);

  return canBeOptional ? schema.nullable() : schema;
};
