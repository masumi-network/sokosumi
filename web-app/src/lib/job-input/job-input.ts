import { z } from "zod";

import { JobInputSchemaIntlPath, ValidJobInputTypes } from "./type";
import { isTypeAndValidationValid } from "./util";
import { validationSchema } from "./validation";

export const jobInputSchema = (t?: IntlTranslation<JobInputSchemaIntlPath>) =>
  z
    .object({
      id: z.string().min(1, {
        message: t?.("Id.required"),
      }),
      type: z.enum(ValidJobInputTypes, {
        message: t?.("Type.enum", {
          options: ValidJobInputTypes.join(", "),
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
          .nonempty({ message: t?.("Data.Values.min") })
          .optional(),
        placeholder: z.string().optional(),
        description: z.string().optional(),
      }),
      validations: z.array(validationSchema(t)).optional(),
    })
    .superRefine((val, ctx) => {
      const { type, data, validations } = val;
      // check type and validations
      if (validations) {
        const isValidationsValid = validations.every((validation) =>
          isTypeAndValidationValid(type, validation.validation),
        );
        if (!isValidationsValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t?.("invalidValidations", { type }),
            path: ["validations"],
          });
        }
      }
      // check values for option type
      if (type === "option" && !data.values) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("optionValuesRequired"),
          path: ["data", "values"],
        });
      } else if (type !== "option" && !!data.values) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t?.("noDataValues"),
          path: ["data", "values"],
        });
      }
    });

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;
