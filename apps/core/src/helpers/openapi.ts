import { z } from "@hono/zod-openapi";
import {
  enterpriseErrorResponseSchema,
  enterpriseSuccessResponseSchema,
} from "@/schemas/enterprise-contract.schema";
import { cursorPaginationMetaSchema } from "@/schemas/pagination.schema";

import { dateTimeSchema } from "./datetime.js";
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

/**
 * Creates an OpenAPI response schema for paginated responses with cursor pagination
 * @param schema - The data schema (typically an array schema)
 * @param description - Description of the response
 * @param example - Optional example response
 * @param paginationMetaSchema - Pagination meta object; defaults to the shared cursor schema
 * @returns OpenAPI response definition with pagination metadata
 */
export function jsonPaginatedSuccessResponse(
  schema: z.ZodTypeAny,
  description: string,
  example?: Record<string, unknown>,
  paginationMetaSchema: z.ZodTypeAny = cursorPaginationMetaSchema,
) {
  const paginatedSchema = z.object({
    data: schema,
    meta: z.object({
      timestamp: dateTimeSchema,
      requestId: z.string(),
      pagination: paginationMetaSchema,
    }),
  });

  const baseContent = jsonContent(paginatedSchema);

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

export function jsonEnterpriseSuccessResponse(
  schema: z.ZodTypeAny,
  description: string,
  example?: Record<string, unknown>,
) {
  const baseContent = jsonContent(enterpriseSuccessResponseSchema(schema));

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

export function jsonEnterpriseErrorResponse(description: string) {
  return {
    description,
    content: jsonContent(enterpriseErrorResponseSchema),
  };
}
