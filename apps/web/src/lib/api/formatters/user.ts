import "server-only";

import { User } from "@sokosumi/database";

import { UserResponse, userResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";

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
    notificationsOptIn: user.notificationsOptIn,
    stripeCustomerId: user.stripeCustomerId,
  };

  // Validate the formatted response
  return userResponseSchema.parse(formatted);
}
