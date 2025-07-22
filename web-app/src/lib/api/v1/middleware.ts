import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "./utils";

export interface ApiRouteHandler<T> {
  (request: NextRequest, context: T): Promise<NextResponse>;
}

export function withErrorHandling<T>(
  handler: ApiRouteHandler<T>,
): ApiRouteHandler<T> {
  return async (request: NextRequest, context: T) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

export function withCors<T>(handler: ApiRouteHandler<T>): ApiRouteHandler<T> {
  return async (request: NextRequest, context: T) => {
    const response = await handler(request, context);

    // Add CORS headers
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    return response;
  };
}

export function createApiRoute<T>(
  handler: ApiRouteHandler<T>,
): ApiRouteHandler<T> {
  return withErrorHandling(withCors(handler));
}
