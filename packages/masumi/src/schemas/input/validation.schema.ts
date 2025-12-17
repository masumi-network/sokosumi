import * as z from "zod";

import { InputFormat, InputValidation } from "../../types/input-types.js";

const formatNonEmptyValidationValueSchema = z.enum([InputFormat.NON_EMPTY]);

const formatUrlValidationValueSchema = z.enum([InputFormat.URL]);

const formatEmailValidationValueSchema = z.enum([InputFormat.EMAIL]);

const formatIntegerValidationValueSchema = z.enum([InputFormat.INTEGER]);

const formatTelPatternValidationValueSchema = z.enum([InputFormat.TEL_PATTERN]);

const optionalValidationValueSchema = z.enum(["true", "false"] as const);

export const optionalValidationSchema = z.object({
  validation: z.enum([InputValidation.OPTIONAL]),
  value: optionalValidationValueSchema,
});

export const minValidationSchema = z.object({
  validation: z.enum([InputValidation.MIN]),
  value: z.union([z.coerce.number().int().min(0), z.string().min(1)]),
});

export const maxValidationSchema = z.object({
  validation: z.enum([InputValidation.MAX]),
  value: z.union([z.coerce.number().int().min(0), z.string().min(1)]),
});

export const formatUrlValidationSchema = z.object({
  validation: z.enum([InputValidation.FORMAT]),
  value: formatUrlValidationValueSchema,
});

export const formatEmailValidationSchema = z.object({
  validation: z.enum([InputValidation.FORMAT]),
  value: formatEmailValidationValueSchema,
});

export const formatIntegerValidationSchema = z.object({
  validation: z.enum([InputValidation.FORMAT]),
  value: formatIntegerValidationValueSchema,
});

export const formatNonEmptyValidationSchema = z.object({
  validation: z.enum([InputValidation.FORMAT]),
  value: formatNonEmptyValidationValueSchema,
});

export const acceptValidationSchema = z.object({
  validation: z.enum([InputValidation.ACCEPT]),
  value: z.string().min(1),
});

export const formatTelPatternValidationSchema = z.object({
  validation: z.enum([InputValidation.FORMAT]),
  value: formatTelPatternValidationValueSchema,
});

export const maxSizeValidationSchema = z.object({
  validation: z.enum([InputValidation.MAX_SIZE]),
  value: z.coerce.number().int().min(0),
});

export const stepValidationSchema = z.object({
  validation: z.enum([InputValidation.STEP]),
  value: z.coerce.number().min(0),
});

export const validationSchema = optionalValidationSchema
  .or(minValidationSchema)
  .or(maxValidationSchema)
  .or(formatUrlValidationSchema)
  .or(formatEmailValidationSchema)
  .or(formatIntegerValidationSchema)
  .or(formatNonEmptyValidationSchema)
  .or(acceptValidationSchema)
  .or(formatTelPatternValidationSchema)
  .or(maxSizeValidationSchema)
  .or(stepValidationSchema);

export type ValidationSchemaType = z.infer<typeof validationSchema>;
