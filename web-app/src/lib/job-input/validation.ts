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
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatUrlValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.URL], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatEmailValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.EMAIL], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const formatIntegerValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum([ValidJobInputFormatValues.INTEGER], {
    message: t?.("Validations.Value.enum", {
      options: Object.values(ValidJobInputFormatValues).join(", "),
      validation: "format",
    }),
  });

const optionalValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum(["true", "false"] as const, {
    message: t?.("Validations.Value.enum", {
      options: ["true", "false"].join(", "),
      validation: "optional",
    }),
  });

export const optionalValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.OPTIONAL], {
      message: t?.("Validations.Validation.enum", {
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
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.coerce.number().int().min(0),
  });

export const maxValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.MAX], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.coerce.number().int().min(0),
  });

export const formatUrlValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.FORMAT], {
      message: t?.("Validations.Validation.enum", {
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
      message: t?.("Validations.Validation.enum", {
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
      message: t?.("Validations.Validation.enum", {
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
      message: t?.("Validations.Validation.enum", {
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
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.string().min(1, {
      message: t?.("Validations.Value.required", { validation: "accept" }),
    }),
  });

export const maxSizeValidationSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    validation: z.enum([ValidJobInputValidationTypes.MAX_SIZE], {
      message: t?.("Validations.Validation.enum", {
        options: Object.values(ValidJobInputValidationTypes).join(", "),
      }),
    }),
    value: z.coerce.number().int().min(0),
  });
