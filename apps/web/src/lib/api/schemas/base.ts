import * as z from "zod";

import { apiErrorResponseSchema } from "./error";

/**
 * Standardized API success response schema
 * Provides consistent success structure across all API endpoints
 */
export const apiSuccessResponseSchema = z.object({
  /** Indicates successful operation (always true for success responses) */
  success: z.boolean().default(true),

  /** The actual response data (can be any type) */
  data: z.any().optional(),

  /** ISO timestamp when the response was generated */
  timestamp: z.iso.datetime(),
});

/**
 * Generic TypeScript type for API success responses
 */
export type ApiSuccessResponse<T = unknown> = {
  success: true;
  data?: T;
  timestamp: string;
};

/**
 * Helper function to create a standardized success response object
 *
 * @param data - The response data
 * @returns Standardized success response object
 */
export function createSuccessResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper function to create a success response with no data
 *
 * @returns Standardized success response object without data
 */
export function createEmptyResponse(): ApiSuccessResponse<void> {
  return {
    success: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Base response schema that can be either success or error
 */
export const apiBaseResponseSchema = z.union([
  apiSuccessResponseSchema,
  apiErrorResponseSchema,
]);
