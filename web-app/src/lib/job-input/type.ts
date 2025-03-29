import { z } from "zod";

import {
  formatNonEmptyValidationSchema,
  formatNumberValidationSchema,
  formatStringValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  requiredValidationSchema,
} from "./validation";

export enum ValidJobInputTypes {
  String = "string",
  Number = "number",
  Boolean = "boolean",
  Option = "option",
  None = "none",
}
export enum ValidJobInputValidationTypes {
  Min = "min",
  Max = "max",
  Format = "format",
  Required = "required",
}

export enum ValidJobInputFormatValues {
  Url = "url",
  Email = "email",
  Integer = "integer",
  Nonempty = "nonempty",
}

type JobInputType = ValidJobInputTypes;
type JobInputValidationType = ValidJobInputValidationTypes;
type JobInputFormatValue = ValidJobInputFormatValues;

type JobInputSchemaIntlPath = "Library.JobInput.Schema";
export type {
  JobInputFormatValue,
  JobInputSchemaIntlPath,
  JobInputType,
  JobInputValidationType,
};

export const InputStringSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().nonempty({
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.String], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().nonempty({
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        requiredValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatStringValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export const InputNumberSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().nonempty({
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.Number], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().nonempty({
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z
      .array(
        requiredValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNumberValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export const InputBooleanSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().nonempty({
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.Boolean], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().nonempty({
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z.array(requiredValidationSchema(t)).optional(),
  });

export const InputOptionSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().nonempty({
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.Option], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().nonempty({
      message: t?.("Name.required"),
    }),
    data: z.object({
      values: z
        .array(
          z.string().min(1, {
            message: t?.("Data.Values.value.required"),
          }),
        )
        .min(1, { message: t?.("Data.Values.min") }),
      placeholder: z.string().optional(),
      description: z.string().optional(),
    }),
    validations: z
      .array(
        requiredValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export const InputNoneSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  z.object({
    id: z.string().nonempty({
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.None], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().nonempty({
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().nonempty().optional(),
      })
      .optional(),
  });
