import "server-only";

import { UserResponse, userResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { User } from "@/prisma/generated/client";

/**
 * Formats user data for API response
 */
export function formatUserResponse(user: User): UserResponse {
  const formatted = {
    id: user.id,
    createdAt: dateToISO(user.createdAt),
    updatedAt: dateToISO(user.updatedAt),
    name: user.name,
    email: user.email,
    termsAccepted: user.termsAccepted,
    marketingOptIn: user.marketingOptIn,
    stripeCustomerId: user.stripeCustomerId,
  };

  // Validate the formatted response
  return userResponseSchema.parse(formatted);
}
