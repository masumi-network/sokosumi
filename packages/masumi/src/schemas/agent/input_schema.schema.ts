import { z } from "zod";

import { inputsSchema } from "../input/input.schema.js";

export const inputSchemaResponseSchema = z.object({
  inputsSchema,
});

export type InputSchemaResponseSchemaType = z.infer<
  typeof inputSchemaResponseSchema
>;
