import { z } from "@hono/zod-openapi";

import { errorResponseSchema } from "./error.js";
import { successResponseSchema } from "./response.js";

export function jsonContent(schema: z.ZodTypeAny) {
  return {
    "application/json": {
      schema,
    },
  };
}

export function jsonSuccessResponse(
  schema: z.ZodTypeAny,
  description: string,
  example?: Record<string, unknown>,
) {
  const baseContent = jsonContent(successResponseSchema(schema));

  const content = example
    ? {
        "application/json": {
          ...baseContent["application/json"],
          example,
        },
      }
    : baseContent;

  return {
    description,
    content,
  };
}

export function jsonErrorResponse(description: string) {
  return {
    description,
    content: jsonContent(errorResponseSchema),
  };
}
