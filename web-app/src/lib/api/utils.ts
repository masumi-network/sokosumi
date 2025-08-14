import "server-only";

import { APIError } from "better-auth/api";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";

/**
 * Validates API key authentication via Better Auth
 * @param headers - Request headers containing x-api-key
 * @returns Session object if valid
 * @throws Error with "UNAUTHORIZED" if invalid
 */
export async function validateApiKeySession(headers: Headers) {
  const session = await auth.api.getSession({ headers });

  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  return session;
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
