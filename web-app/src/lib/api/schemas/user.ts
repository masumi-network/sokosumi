import * as z from "zod";

/**
 * Schema for updating user profile information.
 * Used for both PUT and PATCH endpoints.
 */
export function updateUserProfileSchema() {
  return z.object({
    name: z.string().min(1).max(255).optional(),
    marketingOptIn: z.boolean().optional(),
    jobStatusEmailNotificationsEnabled: z.boolean().optional(),
  });
}

/**
 * Schema for PUT /users/me - requires all updatable fields
 */
export function updateUserProfileFullSchema() {
  return z.object({
    name: z.string().min(1).max(255),
    marketingOptIn: z.boolean(),
    jobStatusEmailNotificationsEnabled: z.boolean(),
  });
}

/**
 * Schema for DELETE /users/me - requires confirmation
 */
export function deleteUserSchema() {
  return z.object({
    currentPassword: z.string().min(1).max(255),
  });
}

/**
 * Schema for user response data (inner user object)
 */
export const userResponseSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(), // ISO date string
  updatedAt: z.iso.datetime(), // ISO date string
  name: z.string(),
  email: z.string(),
  termsAccepted: z.boolean(),
  marketingOptIn: z.boolean(),
  jobStatusEmailNotificationsEnabled: z.boolean(),
  stripeCustomerId: z.string().nullable(),
});

// Type exports for use in API routes
export type UpdateUserProfileType = z.infer<
  ReturnType<typeof updateUserProfileSchema>
>;
export type UpdateUserProfileFullType = z.infer<
  ReturnType<typeof updateUserProfileFullSchema>
>;
export type DeleteUserType = z.infer<ReturnType<typeof deleteUserSchema>>;
export type UserResponse = z.infer<typeof userResponseSchema>;
