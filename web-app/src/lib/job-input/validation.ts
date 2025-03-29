import { z } from "zod";

import {
  JobInputSchemaIntlPath,
  ValidFormatValues,
  ValidValidationTypes,
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

const formatValidationValueSchema = (
  t?: IntlTranslation<JobInputSchemaIntlPath>,
) =>
  z.enum(ValidFormatValues, {
    message: t?.("Validations.Value.enum", {
      options: ValidFormatValues.join(", "),
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

export const validationSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  z
    .object({
      validation: z.enum(ValidValidationTypes, {
        message: t?.("Validations.Validation.enum", {
          options: ValidValidationTypes.join(", "),
        }),
      }),
      value: z.string().optional(),
    })
    .superRefine((val, ctx) => {
      const { validation, value } = val;

      switch (validation) {
        case "min":
        case "max": {
          validateValue(
            ctx,
            limitValidationValueSchema(validation, t),
            value,
            t?.("Validations.Value.invalid", { validation }),
          );
          break;
        }
        case "format": {
          validateValue(
            ctx,
            formatValidationValueSchema(t),
            value,
            t?.("Validations.Value.invalid", { validation }),
          );
          break;
        }
        case "required": {
          validateValue(
            ctx,
            requiredValidationValueSchema(t),
            value,
            t?.("Validations.Value.invalid", { validation }),
          );
          break;
        }
      }
    });

const validateValue = (
  ctx: z.RefinementCtx,
  validationValueSchema: z.Schema,
  value: string | undefined,
  invalidMessage: string | undefined,
) => {
  const validatedResult = validationValueSchema.safeParse(value);
  if (!validatedResult.success) {
    if (validatedResult.error.issues.length > 0) {
      validatedResult.error.issues.forEach((issue) =>
        ctx.addIssue({ ...issue, path: ["value"] }),
      );
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: invalidMessage,
        path: ["value"],
      });
    }
  }
};

export type ValidationSchemaType = z.infer<ReturnType<typeof validationSchema>>;
