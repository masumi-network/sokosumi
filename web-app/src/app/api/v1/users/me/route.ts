import { APIError } from "better-auth/api";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { userRepository } from "@/lib/db/repositories";
import {
  deleteUserSchema,
  updateUserProfileFullSchema,
  updateUserProfileSchema,
} from "@/lib/schemas";
import { User } from "@/prisma/generated/client";

async function validateSession(headers: Headers) {
  const session = await auth.api.getSession({ headers });

  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  return session;
}

// Helper function for updating user via Better Auth and fetching result
async function updateUserAndFetch(
  session: { user: { id: string } },
  headers: Headers,
  data: { name?: string; marketingOptIn?: boolean },
): Promise<User> {
  // Update via Better Auth API (fires hooks, updates session cache)
  const result = await auth.api.updateUser({
    headers,
    body: data,
  });

  if (!result.status) {
    throw new Error("Failed to update user");
  }

  // Fetch the complete updated user from repository
  const user = await userRepository.getUserById(session.user.id);
  if (!user) {
    throw new Error("User not found after update");
  }

  return user;
}

// Helper function for common error handling
function handleApiError(error: unknown, operation: string): NextResponse {
  console.error(`Error in ${operation}:`, error);

  if (error instanceof APIError) {
    return NextResponse.json(
      { error: "Unauthorized", message: error.message || "Invalid API key" },
      { status: 401 },
    );
  }

  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json(
      { error: "Unauthorized", message: "Valid API key required" },
      { status: 401 },
    );
  }

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

  return NextResponse.json(
    {
      error: "Internal Server Error",
      message: `Failed to ${operation}`,
    },
    { status: 500 },
  );
}

function formatUserResponse(user: User) {
  return {
    user: {
      id: user.id,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      name: user.name,
      email: user.email,
      termsAccepted: user.termsAccepted,
      marketingOptIn: user.marketingOptIn,
      stripeCustomerId: user.stripeCustomerId,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await validateSession(request.headers);
    const user = await userRepository.getUserById(session.user.id);
    if (!user) {
      throw new Error("UNAUTHORIZED");
    }
    return NextResponse.json(formatUserResponse(user));
  } catch (error) {
    return handleApiError(error, "retrieve user information");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await validateSession(request.headers);

    const body = await request.json();
    const validatedData = updateUserProfileFullSchema().parse(body);

    const updatedUser = await updateUserAndFetch(
      session,
      request.headers,
      validatedData,
    );

    return NextResponse.json(formatUserResponse(updatedUser));
  } catch (error) {
    return handleApiError(error, "update user information");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await validateSession(request.headers);

    const body = await request.json();
    const validatedData = updateUserProfileSchema().parse(body);

    // Only update if there are actually fields to update
    if (Object.keys(validatedData).length === 0) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: "No valid fields provided for update",
        },
        { status: 400 },
      );
    }

    const updatedUser = await updateUserAndFetch(
      session,
      request.headers,
      validatedData,
    );

    return NextResponse.json(formatUserResponse(updatedUser));
  } catch (error) {
    return handleApiError(error, "update user information");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await validateSession(request.headers);

    const body = await request.json();
    const validatedData = deleteUserSchema().parse(body);

    await auth.api.deleteUser({
      headers: request.headers,
      body: {
        password: validatedData.currentPassword,
      },
    });

    return NextResponse.json({
      message: "Account successfully deleted",
    });
  } catch (error) {
    return handleApiError(error, "delete user account");
  }
}
