import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";

import { getSession } from "@/lib/auth/utils";

import {
  API_ERROR_CODES,
  ApiError,
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
} from "./types";

export function createApiResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
  };
}

export function createApiError(error: ApiError): ApiResponse {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

export function createPaginatedResponse<T>(
  data: T[],
  pagination: {
    page: number;
    limit: number;
    total: number;
  },
): PaginatedResponse<T[]> {
  return {
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
    },
  };
}

export class ApiErrorClass extends Error {
  constructor(
    public code: string,
    public message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleApiError(error: unknown): NextResponse {
  console.error("API Error:", error);

  if (error instanceof ApiErrorClass) {
    return NextResponse.json(
      createApiError({
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
      }),
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      createApiError({
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: "Validation failed",
        status: 400,
        details: error.errors,
      }),
      { status: 400 },
    );
  }

  const message =
    error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json(
    createApiError({
      code: API_ERROR_CODES.INTERNAL_ERROR,
      message,
      status: 500,
    }),
    { status: 500 },
  );
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    throw new ApiErrorClass(
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication required",
      401,
    );
  }
  return session;
}

export function validateParams<T>(schema: ZodSchema<T>, params: unknown): T {
  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiErrorClass(
        API_ERROR_CODES.VALIDATION_ERROR,
        "Invalid parameters",
        400,
        error.errors,
      );
    }
    throw error;
  }
}

export function extractPaginationParams(
  request: NextRequest,
): PaginationParams {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") ?? "20", 10),
    100, // Max limit
  );

  return { page: Math.max(1, page), limit: Math.max(1, limit) };
}

export function extractSearchParams(request: NextRequest): URLSearchParams {
  return new URL(request.url).searchParams;
}
