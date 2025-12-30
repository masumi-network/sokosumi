import * as z from "zod";

import { InputType, OutputFormat } from "../../types/input-types.js";
import {
  acceptValidationSchema,
  formatEmailValidationSchema,
  formatIntegerValidationSchema,
  formatNonEmptyValidationSchema,
  formatTelPatternValidationSchema,
  formatUrlValidationSchema,
  maxValidationSchema,
  minValidationSchema,
  optionalValidationSchema,
} from "./validation.schema.js";

export const inputNoneSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.NONE]),
  name: z.string().min(1),
  data: z
    .object({
      description: z.string().min(1).nullish(),
    })
    .nullish(),
});

export type InputNoneSchemaType = z.infer<typeof inputNoneSchema>;

export const inputStringSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.STRING]),
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

export type InputStringSchemaType = z.infer<typeof inputStringSchema>;

export const inputTextSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.TEXT]),
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

export type InputTextSchemaType = z.infer<typeof inputTextSchema>;

export const inputTextareaSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.TEXTAREA]),
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

export type InputTextareaSchemaType = z.infer<typeof inputTextareaSchema>;

export const inputNumberSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.NUMBER]),
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

export type InputNumberSchemaType = z.infer<typeof inputNumberSchema>;

export const inputBooleanSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.BOOLEAN]),
  name: z.string().min(1),
  data: z
    .object({
      placeholder: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type InputBooleanSchemaType = z.infer<typeof inputBooleanSchema>;

export const inputEmailSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.EMAIL]),
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

export type InputEmailSchemaType = z.infer<typeof inputEmailSchema>;

export const inputPasswordSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.PASSWORD]),
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

export type InputPasswordSchemaType = z.infer<typeof inputPasswordSchema>;

export const inputTelSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.TEL]),
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

export type InputTelSchemaType = z.infer<typeof inputTelSchema>;

export const inputUrlSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.URL]),
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

export type InputUrlSchemaType = z.infer<typeof inputUrlSchema>;

export const inputDateSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.DATE]),
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

export type InputDateSchemaType = z.infer<typeof inputDateSchema>;

export const inputDatetimeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.DATETIME]),
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

export type InputDatetimeSchemaType = z.infer<typeof inputDatetimeSchema>;

export const inputTimeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.TIME]),
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

export type InputTimeSchemaType = z.infer<typeof inputTimeSchema>;

export const inputMonthSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.MONTH]),
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

export type InputMonthSchemaType = z.infer<typeof inputMonthSchema>;

export const inputWeekSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.WEEK]),
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

export type InputWeekSchemaType = z.infer<typeof inputWeekSchema>;

export const inputColorSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.COLOR]),
  name: z.string().min(1),
  data: z
    .object({
      default: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type InputColorSchemaType = z.infer<typeof inputColorSchema>;

export const inputRangeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.RANGE]),
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

export type InputRangeSchemaType = z.infer<typeof inputRangeSchema>;

export const inputFileSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.FILE]),
  name: z.string().min(1),
  data: z.object({
    description: z.string().nullish(),
    outputFormat: z.enum(OutputFormat),
  }),
  validations: z
    .array(
      optionalValidationSchema
        .or(acceptValidationSchema)
        .or(minValidationSchema)
        .or(maxValidationSchema),
    )
    .nullish(),
});

export type InputFileSchemaType = z.infer<typeof inputFileSchema>;

export const inputHiddenSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.HIDDEN]),
  name: z.string().min(1),
  data: z
    .object({
      value: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type InputHiddenSchemaType = z.infer<typeof inputHiddenSchema>;

export const inputSearchSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.SEARCH]),
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

export type InputSearchSchemaType = z.infer<typeof inputSearchSchema>;

export const inputCheckboxSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.CHECKBOX]),
  name: z.string().min(1),
  data: z.object({
    label: z.string().nullish(),
    description: z.string().nullish(),
    default: z.boolean().nullish(),
  }),
  validations: z.array(optionalValidationSchema).nullish(),
});

export type InputCheckboxSchemaType = z.infer<typeof inputCheckboxSchema>;

export const inputRadioGroupSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.RADIO_GROUP]),
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

export type InputRadioGroupSchemaType = z.infer<typeof inputRadioGroupSchema>;

export const inputOptionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.OPTION]),
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

export type InputOptionSchemaType = z.infer<typeof inputOptionSchema>;

export const inputMultiselectSchema = z.object({
  id: z.string().min(1),
  type: z.enum([InputType.MULTISELECT]),
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

export type InputMultiselectSchemaType = z.infer<typeof inputMultiselectSchema>;

export const inputFieldSchema = inputNoneSchema
  .or(inputStringSchema)
  .or(inputTextSchema)
  .or(inputTextareaSchema)
  .or(inputNumberSchema)
  .or(inputBooleanSchema)
  .or(inputEmailSchema)
  .or(inputPasswordSchema)
  .or(inputTelSchema)
  .or(inputUrlSchema)
  .or(inputDateSchema)
  .or(inputDatetimeSchema)
  .or(inputTimeSchema)
  .or(inputMonthSchema)
  .or(inputWeekSchema)
  .or(inputColorSchema)
  .or(inputRangeSchema)
  .or(inputFileSchema)
  .or(inputHiddenSchema)
  .or(inputSearchSchema)
  .or(inputCheckboxSchema)
  .or(inputRadioGroupSchema)
  .or(inputOptionSchema)
  .or(inputMultiselectSchema);

export type InputFieldSchemaType = z.infer<typeof inputFieldSchema>;

export const inputFieldsSchema = z.array(inputFieldSchema).refine(
  (data) => {
    const ids = data.map((input) => input.id);
    return new Set(ids).size === ids.length;
  },
  {
    message: "Input IDs must be unique across all inputs",
    path: ["inputs"],
  },
);

export type InputFieldsSchemaType = z.infer<typeof inputFieldsSchema>;

export const inputDataSchema = z.object({
  input_data: inputFieldsSchema,
});

export type InputDataSchemaType = z.infer<typeof inputDataSchema>;

export const inputGroupSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
  })
  .and(inputDataSchema);

export type InputGroupSchemaType = z.infer<typeof inputGroupSchema>;

export const inputGroupsSchema = z
  .array(inputGroupSchema)
  .refine(
    (data) => {
      const ids = data.map((group) => group.id);
      return new Set(ids).size === ids.length;
    },
    {
      message: "Input group IDs must be unique across all input groups",
      path: ["input_groups"],
    },
  )
  .refine(
    (data) => {
      const allInputIds = data.flatMap((group) =>
        group.input_data.map((input) => input.id),
      );
      return new Set(allInputIds).size === allInputIds.length;
    },
    {
      message: "Input IDs must be unique across all input groups",
      path: ["input_groups"],
    },
  );

export type InputGroupsSchemaType = z.infer<typeof inputGroupsSchema>;

export const inputSchemaSchema = z
  .union([inputDataSchema, z.object({ input_groups: inputGroupsSchema })])
  .refine(
    (data) => {
      const hasInputData = "input_data" in data;
      const hasInputGroups = "input_groups" in data;
      return hasInputData !== hasInputGroups; // Exactly one must be present
    },
    {
      message: "Must provide exactly one of 'input_data' or 'input_groups'",
    },
  );

export type InputSchemaSchemaType = z.infer<typeof inputSchemaSchema>;

// Schema for input data when providing input to an agent
export const inputSchema = z.record(
  z.string(),
  z.union([
    z.number(),
    z.array(z.number()),
    z.string(),
    z.array(z.string()),
    z.boolean(),
    z.undefined(),
    z.instanceof(File),
    z.array(z.instanceof(File)),
  ]),
);

export type InputSchemaType = z.infer<typeof inputSchema>;
