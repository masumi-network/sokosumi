import { z } from "zod";

import { JobInputSchemaIntlPath, ValidJobInputTypes } from "./type";
import {
  formatEmailValidationSchema,
  formatIntegerValidationSchema,
  formatNonEmptyValidationSchema,
  formatUrlValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  optionalValidationSchema,
} from "./validation";

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  jobInputStringSchema(t)
    .or(jobInputNumberSchema(t))
    .or(jobInputBooleanSchema(t))
    .or(jobInputOptionSchema(t))
    .or(jobInputNoneSchema(t));

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

export const jobInputStringSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.STRING], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
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
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t))
          .or(formatUrlValidationSchema(t))
          .or(formatEmailValidationSchema(t)),
      )
      .optional(),
  });

export const jobInputNumberSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NUMBER], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
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
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t))
          .or(formatIntegerValidationSchema(t))
          .or(formatNonEmptyValidationSchema(t)),
      )
      .optional(),
  });

export const jobInputBooleanSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.BOOLEAN], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        placeholder: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
    validations: z.array(optionalValidationSchema(t)).optional(),
  });

export const jobInputOptionSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.OPTION], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
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
        optionalValidationSchema(t)
          .or(minValidationSchema(t))
          .or(maxValidationSchema(t)),
      )
      .optional(),
  });

export const jobInputNoneSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.object({
    id: z.string().min(1, {
      message: t?.("Id.required"),
    }),
    type: z.enum([ValidJobInputTypes.NONE], {
      message: t?.("Type.enum", {
        options: Object.values(ValidJobInputTypes).join(", "),
      }),
    }),
    name: z.string().min(1, {
      message: t?.("Name.required"),
    }),
    data: z
      .object({
        description: z.string().min(1).optional(),
      })
      .optional(),
  });
