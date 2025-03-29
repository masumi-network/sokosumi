import { z } from "zod";

import {
  JobInputSchemaIntlPath,
  ValidJobInputFormatValues,
  ValidJobInputValidationTypes,
} from "./type";

const limitValidationValueSchema = (
  validation: "min" | "max",
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z
    .string()
    .min(1, {
      message: t?.("Validations.Value.required", {
        validation,
      }),
    })
    .superRefine((val, ctx) => {
      const numberValue = Number(val);
      if (isNaN(numberValue) || numberValue !== Math.floor(numberValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("Validations.Value.integer", {
            validation,
          }),
        });
      } else if (numberValue < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("Validations.Value.notNegative", {
            validation,
          }),
        });
      }
    });

const formatStringValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum(
    [
      ValidJobInputFormatValues.Url,
      ValidJobInputFormatValues.Email,
      ValidJobInputFormatValues.Nonempty,
    ],
    {
      message: t?.("Validations.Value.enum", {
        options: Object.values(ValidJobInputFormatValues).join(", "),
        validation: "format",
      }),
    },
  );

const formatNumberValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum(
    [ValidJobInputFormatValues.Integer, ValidJobInputFormatValues.Nonempty],
    {
      message: t?.("Validations.Value.enum", {
        options: Object.values(ValidJobInputFormatValues).join(", "),
        validation: "format",
      }),
    },
  );

const requiredValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z
    .enum(["true", "false"] as const, {
      message: t?.("Validations.Value.enum", {
        options: ["true", "false"].join(", "),
        validation: "required",
      }),
    })
    .optional();

export const requiredValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Required], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: requiredValidationValueSchema(t),
  });

export const minValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Min], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: limitValidationValueSchema("min", t),
  });

export const maxValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Max], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: limitValidationValueSchema("max", t),
  });

export const formatStringValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Format], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatStringValidationValueSchema(t),
  });

export const formatNumberValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Format], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatNumberValidationValueSchema(t),
  });
