import "server-only";

import { APIError } from "better-auth/api";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import * as z from "zod";

import {
  ApiSuccessResponse,
  createEmptyResponse,
  createSuccessResponse,
} from "@/lib/api/schemas/base";
import {
  ApiErrorResponse,
  createErrorResponse,
  HttpErrors,
} from "@/lib/api/schemas/error";
import { auth } from "@/lib/auth/auth";

export async function validateApiKey(headers: Headers) {
  const key = headers.get("x-api-key");
  if (!key) {
    throw new Error("UNAUTHORIZED");
  }
  const data = await auth.api.verifyApiKey({
    body: {
      key,
    },
  });

  if (data.error) {
    throw new Error("UNAUTHORIZED");
  }

  if (!data.valid) {
    throw new Error("UNAUTHORIZED");
  }

  const apiKey = data.key;

  if (!apiKey) {
    throw new Error("UNAUTHORIZED");
  }

  return apiKey;
}

/**
 * Enhanced standard error handler for API routes
 * @param error - The error to handle
 * @param operation - Description of the operation that failed
 * @param options - Optional configuration for error handling
 * @returns NextResponse with standardized error format
 */
export function handleApiError(
  error: unknown,
  operation: string,
  options: {
    path?: string;
    requestId?: string;
  } = {},
): NextResponse {
  const requestId = options.requestId ?? uuidv4();

  console.error(`[${requestId}] Error in ${operation}:`, error);

  // Better Auth API errors
  if (error instanceof APIError) {
    const errorResponse = createErrorResponse(
      HttpErrors.UNAUTHORIZED,
      error.message || "Invalid API key",
      {
        code: "AUTH_ERROR",
        path: options.path,
        requestId,
      },
    );
    return NextResponse.json(errorResponse, { status: 401 });
  }

  // Custom error codes mapping
  if (error instanceof Error) {
    const errorMap: Record<
      string,
      { status: number; error: string; code: string }
    > = {
      UNAUTHORIZED: {
        status: 401,
        error: HttpErrors.UNAUTHORIZED,
        code: "UNAUTHORIZED",
      },
      INSUFFICIENT_BALANCE: {
        status: 402,
        error: "Payment Required",
        code: "INSUFFICIENT_BALANCE",
      },
      AGENT_NOT_FOUND: {
        status: 404,
        error: HttpErrors.NOT_FOUND,
        code: "AGENT_NOT_FOUND",
      },
      JOB_NOT_FOUND: {
        status: 404,
        error: HttpErrors.NOT_FOUND,
        code: "JOB_NOT_FOUND",
      },
      INVALID_INPUT: {
        status: 400,
        error: HttpErrors.BAD_REQUEST,
        code: "INVALID_INPUT",
      },
      VALIDATION_ERROR: {
        status: 400,
        error: HttpErrors.BAD_REQUEST,
        code: "VALIDATION_ERROR",
      },
    };

    const mapped = errorMap[error.message];
    if (mapped) {
      const errorResponse = createErrorResponse(
        mapped.error,
        `Failed to ${operation}: ${error.message.toLowerCase().replace(/_/g, " ")}`,
        {
          code: mapped.code,
          path: options.path,
          requestId,
        },
      );
      return NextResponse.json(errorResponse, { status: mapped.status });
    }
  }

  // Zod validation errors
  if (error instanceof z.ZodError) {
    const errorResponse = createErrorResponse(
      HttpErrors.BAD_REQUEST,
      "Validation failed",
      {
        code: "VALIDATION_ERROR",
        details: error.issues,
        path: options.path,
        requestId,
      },
    );
    return NextResponse.json(errorResponse, { status: 400 });
  }

  // Generic server errors
  const errorResponse = createErrorResponse(
    HttpErrors.INTERNAL_SERVER_ERROR,
    `Failed to ${operation}`,
    {
      code: "INTERNAL_ERROR",
      path: options.path,
      requestId,
    },
  );
  return NextResponse.json(errorResponse, { status: 500 });
}

/**
 * Helper function to create standardized success responses
 *
 * @param data - The response data
 * @param options - Optional configuration
 * @returns NextResponse with standardized success format
 */
export function createApiSuccessResponse<T>(
  data: T,
  options: {
    status?: number;
  } = {},
): NextResponse {
  const successResponse = createSuccessResponse(data);

  return NextResponse.json(successResponse, {
    status: options.status ?? 200,
  });
}

/**
 * Helper function to create success responses with no data
 *
 * @param options - Optional configuration
 * @returns NextResponse with standardized success format
 */
export function createApiEmptyResponse(
  options: {
    status?: number;
  } = {},
): NextResponse {
  const emptyResponse = createEmptyResponse();

  return NextResponse.json(emptyResponse, {
    status: options.status ?? 200,
  });
}

/**
 * Converts a Date object to ISO string for JSON serialization
 */
export function dateToISO(date: Date): string {
  return date.toISOString();
}

/**
 * Base type for API responses with common fields
 */
export interface ApiResponseBase {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// Export the new types and helpers for external use
export type { ApiErrorResponse, ApiSuccessResponse };
