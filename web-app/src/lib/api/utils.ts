import "server-only";

import { APIError } from "better-auth/api";
import { NextResponse } from "next/server";
import { z } from "zod";

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
 * Standard error handler for API routes
 * @param error - The error to handle
 * @param operation - Description of the operation that failed
 * @returns NextResponse with appropriate status and message
 */
export function handleApiError(
  error: unknown,
  operation: string,
): NextResponse {
  console.error(`Error in ${operation}:`, error);

  // Better Auth API errors
  if (error instanceof APIError) {
    return NextResponse.json(
      { error: "Unauthorized", message: error.message || "Invalid API key" },
      { status: 401 },
    );
  }

  // Custom unauthorized errors
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json(
      { error: "Unauthorized", message: "Valid API key required" },
      { status: 401 },
    );
  }

  // Zod validation errors
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: "Bad Request",
        message: "Validation failed",
        details: error.errors,
      },
      { status: 400 },
    );
  }

  // Generic server errors
  return NextResponse.json(
    {
      error: "Internal Server Error",
      message: `Failed to ${operation}`,
    },
    { status: 500 },
  );
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
