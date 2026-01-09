import { createRoute } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { APIError } from "better-auth";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { getUserCredits } from "@/helpers/user";
import { auth } from "@/lib/auth";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createUserRequestSchema,
  type User,
  userSchema,
} from "@/schemas/user.schema";

const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createUserRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(userSchema, "User created successfully", {
      data: {
        id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        name: "John Doe",
        email: "john.doe@example.com",
        image: null,
        credits: 0.0,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    409: jsonErrorResponse("Conflict - Email already exists"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");

    try {
      const signUpResult = await auth.api.signUpEmail({
        body: {
          email: body.email,
          name: body.name,
          password: body.password,
          callbackURL: "/",
          marketingOptIn: body.marketingOptIn ?? false,
          termsAccepted: body.termsAccepted,
          onboardingCompleted: false,
        },
      });

      if (!signUpResult.user) {
        throw internalServerError("Failed to create user");
      }

      const user: User = await prisma.$transaction(async (tx) => {
        const credits = await getUserCredits(signUpResult.user.id, tx);
        return userSchema.parse({
          ...signUpResult.user,
          credits,
        });
      });

      return created(c, user);
    } catch (error) {
      console.log("Better Auth Error:", error);
      // Handle Better Auth APIError
      if (error instanceof APIError) {
        //   const errorCode = error.cause?.code;
        //   const errorMessage = error.message;
        //   // Handle specific error codes
        //   if (
        //     errorCode === "EMAIL_ALREADY_EXISTS" ||
        //     errorCode === "USER_ALREADY_EXISTS"
        //   ) {
        //     throw conflict("A user with this email already exists");
        //   }
        //   if (errorCode === "TERMS_NOT_ACCEPTED") {
        //     throw badRequest("Terms of service must be accepted");
        //   }
        //   if (
        //     errorCode === "INVALID_EMAIL" ||
        //     errorCode === "INVALID_PASSWORD" ||
        //     errorCode === "VALIDATION_ERROR"
        //   ) {
        //     throw badRequest(errorMessage);
        //   }
        //   // Default to unprocessable entity for other API errors
        //   throw unprocessableEntity(errorMessage);
        // }
        // // Re-throw known HTTP exceptions (from our error helpers)
        // if (
        //   error &&
        //   typeof error === "object" &&
        //   "status" in error &&
        //   typeof error.status === "number"
        // ) {
        //   throw error;
      }

      // Unknown error
      throw internalServerError(
        "An unexpected error occurred while creating the user",
      );
    }
  });
}
