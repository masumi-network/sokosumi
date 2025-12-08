import { z } from "@hono/zod-openapi";

import { webhookClient } from "@/clients/webhook.client";

/**
 * Internal validation schema for user webhook payloads
 * Not exported - validation is an implementation detail
 */
const marketingOptInUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  marketingOptIn: z.boolean(),
});

export const webhookService = (() => {
  return {
    /**
     * Triggers user created webhook with validation
     * @param user - The user object from the database hook
     */
    async callUserCreated(user: unknown): Promise<void> {
      const { success, data, error } = marketingOptInUserSchema.safeParse(user);
      if (!success) {
        console.error("Invalid user data for user created webhook:", error);
        return;
      }

      await webhookClient.callWebhook("userCreated", {
        userId: data.id,
        email: data.email,
        name: data.name,
        marketingOptIn: data.marketingOptIn,
      });
    },

    /**
     * Triggers user updated webhook with validation
     * @param user - The user object from the database hook
     */
    async callUserUpdated(user: unknown): Promise<void> {
      const { success, data, error } = marketingOptInUserSchema.safeParse(user);
      if (!success) {
        console.error("Invalid user data for user updated webhook:", error);
        return;
      }

      await webhookClient.callWebhook("userUpdated", {
        userId: data.id,
        email: data.email,
        name: data.name,
        marketingOptIn: data.marketingOptIn,
      });
    },

    /**
     * Triggers account created webhook
     * @param userId - The unique identifier of the user
     * @param providerId - The OAuth provider identifier
     */
    async callAccountCreated(
      userId: string,
      providerId: string,
    ): Promise<void> {
      await webhookClient.callWebhook("accountCreated", {
        userId,
        providerId,
      });
    },
  };
})();
