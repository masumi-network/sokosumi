import { z } from "zod";

import { inputSchemaSchema } from "../input/input.schema.js";

export const inputSchemaResponseSchema = inputSchemaSchema;

export type InputSchemaResponseSchemaType = z.infer<
  typeof inputSchemaResponseSchema
>;
