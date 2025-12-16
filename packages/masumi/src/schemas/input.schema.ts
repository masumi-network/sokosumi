import * as z from "zod";

import {
  requiredJobInputFileValidationTypes,
  ValidJobInputTypes,
} from "./types.js";
import {
  acceptValidationSchema,
  formatEmailValidationSchema,
  formatIntegerValidationSchema,
  formatNonEmptyValidationSchema,
  formatTelPatternValidationSchema,
  formatUrlValidationSchema,
  maxSizeValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  optionalValidationSchema,
} from "./validation.schema.js";

/*
 * @deprecated This was a placeholder and is superseded by jobInputSchema.
 *
 */
export const jobInputDataSchema = () =>
  z.object({
    input_data: z.array(jobInputSchema()),
  });

/*
 * @deprecated This was a placeholder and is superseded by JobInputSchemaType.
 */
export type JobInputDataSchemaType = z.infer<
  ReturnType<typeof jobInputDataSchema>
>;

export const jobInputGroupSchema = () =>
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    input_data: z.array(jobInputSchema()),
  });

export type JobInputGroupSchemaType = z.infer<
  ReturnType<typeof jobInputGroupSchema>
>;

export const jobInputsSchema = () => {
  const inputDataSchema = z.object({
    input_data: z.array(jobInputSchema()),
  });

  const inputGroupsSchema = z.object({
    input_groups: z.array(jobInputGroupSchema()),
  });

  return z.union([inputDataSchema, inputGroupsSchema]).refine(
    (data) => {
      const hasInputData = "input_data" in data;
      const hasInputGroups = "input_groups" in data;
      return hasInputData !== hasInputGroups; // Exactly one must be present
    },
    {
      message: "Must provide exactly one of 'input_data' or 'input_groups'",
    },
  );
};

export type JobInputsSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

export const jobInputSchema = () =>
  jobInputNoneSchema
    .or(jobInputStringSchema)
    .or(jobInputTextSchema)
    .or(jobInputTextareaSchema)
    .or(jobInputNumberSchema)
    .or(jobInputBooleanSchema)
    .or(jobInputEmailSchema)
    .or(jobInputPasswordSchema)
    .or(jobInputTelSchema)
    .or(jobInputUrlSchema)
    .or(jobInputDateSchema)
    .or(jobInputDatetimeSchema)
    .or(jobInputTimeSchema)
    .or(jobInputMonthSchema)
    .or(jobInputWeekSchema)
    .or(jobInputColorSchema)
    .or(jobInputRangeSchema)
    .or(jobInputFileSchema)
    .or(jobInputHiddenSchema)
    .or(jobInputSearchSchema)
    .or(jobInputCheckboxSchema)
    .or(jobInputRadioGroupSchema)
    .or(jobInputOptionSchema)
    .or(jobInputMultiselectSchema);

export type JobInputSchemaType = z.infer<ReturnType<typeof jobInputSchema>>;

export const jobInputNoneSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.NONE]),
  name: z.string().min(1),
  data: z
    .object({
      description: z.string().min(1).nullish(),
    })
    .nullish(),
});

export type JobInputNoneSchemaType = z.infer<typeof jobInputNoneSchema>;

export const jobInputStringSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.STRING]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema)
        .or(formatUrlValidationSchema)
        .or(formatEmailValidationSchema),
    )
    .nullish(),
});

export type JobInputStringSchemaType = z.infer<typeof jobInputStringSchema>;

export const jobInputTextSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.TEXT]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema)
        .or(formatUrlValidationSchema)
        .or(formatEmailValidationSchema),
    )
    .nullish(),
});

export type JobInputTextSchemaType = z.infer<typeof jobInputTextSchema>;

export const jobInputTextareaSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.TEXTAREA]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema),
    )
    .nullish(),
});

export type JobInputTextareaSchemaType = z.infer<typeof jobInputTextareaSchema>;

export const jobInputNumberSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.NUMBER]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatIntegerValidationSchema),
    )
    .nullish(),
});

export type JobInputNumberSchemaType = z.infer<typeof jobInputNumberSchema>;

export const jobInputBooleanSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.BOOLEAN]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type JobInputBooleanSchemaType = z.infer<typeof jobInputBooleanSchema>;

export const jobInputEmailSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.EMAIL]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema)
        .or(formatEmailValidationSchema),
    )
    .nullish(),
});

export type JobInputEmailSchemaType = z.infer<typeof jobInputEmailSchema>;

export const jobInputPasswordSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.PASSWORD]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema),
    )
    .nullish(),
});

export type JobInputPasswordSchemaType = z.infer<typeof jobInputPasswordSchema>;

export const jobInputTelSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.TEL]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatTelPatternValidationSchema),
    )
    .nullish(),
});

export type JobInputTelSchemaType = z.infer<typeof jobInputTelSchema>;

export const jobInputUrlSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.URL]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema)
        .or(formatUrlValidationSchema),
    )
    .nullish(),
});

export type JobInputUrlSchemaType = z.infer<typeof jobInputUrlSchema>;

export const jobInputDateSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.DATE]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputDateSchemaType = z.infer<typeof jobInputDateSchema>;

export const jobInputDatetimeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.DATETIME]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputDatetimeSchemaType = z.infer<typeof jobInputDatetimeSchema>;

export const jobInputTimeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.TIME]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputTimeSchemaType = z.infer<typeof jobInputTimeSchema>;

export const jobInputMonthSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.MONTH]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputMonthSchemaType = z.infer<typeof jobInputMonthSchema>;

export const jobInputWeekSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.WEEK]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputWeekSchemaType = z.infer<typeof jobInputWeekSchema>;

export const jobInputColorSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.COLOR]),
  name: z.string().min(1),
  data: z
    .object({
      default: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type JobInputColorSchemaType = z.infer<typeof jobInputColorSchema>;

export const jobInputRangeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.RANGE]),
  name: z.string().min(1),
  data: z
    .object({
      description: z.string().nullish(),
      step: z.coerce.number().min(0).nullish(),
      default: z.coerce.number().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputRangeSchemaType = z.infer<typeof jobInputRangeSchema>;

export const jobInputFileSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.FILE]),
  name: z.string().min(1),
  data: z.object({
    description: z.string().nullish(),
    outputFormat: z.string().nullish(),
  }),
  validations: z
    .array(
      acceptValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(maxSizeValidationSchema),
    )
    .refine((validations) => {
      for (const validationType of requiredJobInputFileValidationTypes) {
        if (
          validations.find((v) => v.validation === validationType) === undefined
        ) {
          return false;
        }
      }
      return true;
    }),
});

export type JobInputFileSchemaType = z.infer<typeof jobInputFileSchema>;

export const jobInputHiddenSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.HIDDEN]),
  name: z.string().min(1),
  data: z
    .object({
      value: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type JobInputHiddenSchemaType = z.infer<typeof jobInputHiddenSchema>;

export const jobInputSearchSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.SEARCH]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z
    .array(
      optionalValidationSchema
        .or(minValidationSchema)
        .or(maxValidationSchema)
        .or(formatNonEmptyValidationSchema),
    )
    .nullish(),
});

export type JobInputSearchSchemaType = z.infer<typeof jobInputSearchSchema>;

export const jobInputCheckboxSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.CHECKBOX]),
  name: z.string().min(1),
  data: z.object({
    label: z.string().nullish(),
    description: z.string().nullish(),
    default: z.boolean().nullish(),
  }),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type JobInputCheckboxSchemaType = z.infer<typeof jobInputCheckboxSchema>;

export const jobInputRadioGroupSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.RADIO_GROUP]),
  name: z.string().min(1),
  data: z.object({
    values: z
      .array(z.string().min(1))
      .min(1)
      .refine((items) => new Set(items).size === items.length),
    description: z.string().nullish(),
  }),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputRadioGroupSchemaType = z.infer<
  typeof jobInputRadioGroupSchema
>;

export const jobInputOptionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.OPTION]),
  name: z.string().min(1),
  data: z.object({
    values: z
      .array(z.string().min(1))
      .min(1)
      .refine((items) => new Set(items).size === items.length),
    placeholder: z.string().nullish(),
    description: z.string().nullish(),
  }),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputOptionSchemaType = z.infer<typeof jobInputOptionSchema>;

export const jobInputMultiselectSchema = z.object({
  id: z.string().min(1),
  type: z.enum([ValidJobInputTypes.MULTISELECT]),
  name: z.string().min(1),
  data: z.object({
    values: z.array(z.string().min(1)).min(1),
    placeholder: z.string().nullish(),
    description: z.string().nullish(),
  }),
  validations: z
    .array(
      optionalValidationSchema.or(minValidationSchema).or(maxValidationSchema),
    )
    .nullish(),
});

export type JobInputMultiselectSchemaType = z.infer<
  typeof jobInputMultiselectSchema
>;
