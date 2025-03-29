import { z } from "zod";

import {
  JobInputSchemaIntlPath,
  ValidJobInputFormatValues,
  ValidJobInputValidationTypes,
} from "./type";

const formatNonEmptyValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.Nonempty], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatStringValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.Url, ValidJobInputFormatValues.Email], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatNumberValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.Integer], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

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
    value: z.number({ coerce: true }).int().min(0),
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
    value: z.number({ coerce: true }).int().min(0),
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

export const formatNonEmptyValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.Format], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatNonEmptyValidationValueSchema(t),
  });
