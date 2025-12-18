import { z } from "zod";

import { inputDataSchema, inputGroupsSchema } from "../input/input.schema.js";

export const inputSchemaResponseSchema = z
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

export type InputSchemaResponseSchemaType = z.infer<
  typeof inputSchemaResponseSchema
>;
