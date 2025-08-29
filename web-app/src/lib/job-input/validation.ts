import { z } from "zod";

import {
  JobInputSchemaIntlPath,
  ValidJobInputFormatValues,
  ValidJobInputValidationTypes,
} from "./type";

const formatNonEmptyValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.NON_EMPTY], {
    error: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatUrlValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.URL], {
    error: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatEmailValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.EMAIL], {
    error: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatIntegerValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.INTEGER], {
    error: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatTelPatternValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.TEL_PATTERN], {
    error: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const optionalValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum(["true", "false"] as const, {
    error: t?.("Validations.Value.enum", {
      options: ["true", "false"].join(", "),
      validation: "optional",
    }),
  });

export const optionalValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.OPTIONAL], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: optionalValidationValueSchema(t),
  });

export const minValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.MIN], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.union([z.coerce.number().int().min(0), z.string().min(1)]),
  });

export const maxValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.MAX], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.union([z.coerce.number().int().min(0), z.string().min(1)]),
  });

export const formatUrlValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatUrlValidationValueSchema(t),
  });

export const formatEmailValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatEmailValidationValueSchema(t),
  });

export const formatIntegerValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatIntegerValidationValueSchema(t),
  });

export const formatNonEmptyValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatNonEmptyValidationValueSchema(t),
  });

export const acceptValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.ACCEPT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.string().min(1, {
      error: t?.("Validations.Value.required", { validation: "accept" }),
    }),
  });

export const formatTelPatternValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: formatTelPatternValidationValueSchema(t),
  });

export const maxSizeValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.MAX_SIZE], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.coerce.number().int().min(0),
  });

export const stepValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.STEP], {
      error: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.coerce.number().min(0),
  });

export const validationSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  optionalValidationSchema(t)
    .or(minValidationSchema(t))
    .or(maxValidationSchema(t))
    .or(formatUrlValidationSchema(t))
    .or(formatEmailValidationSchema(t))
    .or(formatIntegerValidationSchema(t))
    .or(formatNonEmptyValidationSchema(t))
    .or(acceptValidationSchema(t))
    .or(formatTelPatternValidationSchema(t))
    .or(maxSizeValidationSchema(t))
    .or(stepValidationSchema(t));
export type ValidationSchemaType = z.infer<ReturnType<typeof validationSchema>>;
