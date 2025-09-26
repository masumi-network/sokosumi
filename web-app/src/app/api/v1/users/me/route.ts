import { NextRequest } from "next/server";

import {
  createApiEmptyResponse,
  createApiSuccessResponse,
  deleteUserSchema,
  formatUserResponse,
  handleApiError,
  updateUserProfileFullSchema,
  updateUserProfileSchema,
  validateApiKey,
} from "@/lib/api";
import { auth } from "@/lib/auth/auth";
import { userRepository } from "@/lib/db/repositories";
import { User } from "@/prisma/generated/client";

// Helper function for updating user via Better Auth and fetching result
async function updateUserAndFetch(
  userId: string,
  headers: Headers,
  data: {
    name?: string;
    marketingOptIn?: boolean;
    jobStatusEmailNotificationsEnabled?: boolean;
  },
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
  const user = await userRepository.getUserById(userId);
  if (!user) {
    throw new Error("User not found after update");
  }

  return user;
}

/**
 * Get current user
 * @description Retrieves the authenticated user's profile
 * @response UserSuccessResponse
 * @responseSet public
 * @tag Users
 * @auth apikey
 * @openapi
 */
export async function GET(request: NextRequest) {
  try {
    const apiKey = await validateApiKey(request.headers);
    const user = await userRepository.getUserById(apiKey.userId);
    if (!user) {
      throw new Error("UNAUTHORIZED");
    }
    return createApiSuccessResponse(formatUserResponse(user));
  } catch (error) {
    return handleApiError(error, "retrieve user information");
  }
}

/**
 * Replace current user profile
 * @description Replaces the authenticated user's profile with provided data
 * @body UpdateUserProfileSchema
 * @bodyDescription The full profile data to replace the current user profile (Required).
 * @response UserSuccessResponse
 * @responseSet public
 * @tag Users
 * @auth apikey
 * @openapi
 */
export async function PUT(request: NextRequest) {
  try {
    const apiKey = await validateApiKey(request.headers);

    const body = await request.json();
    const validatedData = updateUserProfileFullSchema().parse(body);

    const updatedUser = await updateUserAndFetch(
      apiKey.userId,
      request.headers,
      validatedData,
    );

    return createApiSuccessResponse(formatUserResponse(updatedUser));
  } catch (error) {
    return handleApiError(error, "update user information");
  }
}

/**
 * Update current user profile
 * @description Updates fields of the authenticated user's profile
 * @body UpdateUserProfileSchema
 * @bodyDescription The full profile data to replace the current user profile (Optional).
 * @response UserSuccessResponse
 * @responseSet public
 * @tag Users
 * @auth apikey
 * @openapi
 */
export async function PATCH(request: NextRequest) {
  try {
    const apiKey = await validateApiKey(request.headers);

    const body = await request.json();
    const validatedData = updateUserProfileSchema().parse(body);

    // Only update if there are actually fields to update
    if (Object.keys(validatedData).length === 0) {
      throw new Error("INVALID_INPUT");
    }

    const updatedUser = await updateUserAndFetch(
      apiKey.userId,
      request.headers,
      validatedData,
    );

    return createApiSuccessResponse(formatUserResponse(updatedUser));
  } catch (error) {
    return handleApiError(error, "update user information");
  }
}

/**
 * Delete current user account
 * @description Deletes the authenticated user's account after verifying password
 * @body DeleteUserSchema
 * @bodyDescription The current account password (Required).
 * @response void
 * @responseSet public
 * @tag Users
 * @auth apikey
 */
export async function DELETE(request: NextRequest) {
  try {
    const _apiKey = await validateApiKey(request.headers);

    const body = await request.json();
    const validatedData = deleteUserSchema().parse(body);

    await auth.api.deleteUser({
      headers: request.headers,
      body: {
        password: validatedData.currentPassword,
      },
    });

    return createApiEmptyResponse({ status: 204 });
  } catch (error) {
    return handleApiError(error, "delete user account");
  }
}
