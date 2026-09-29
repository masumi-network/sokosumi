import { z } from "@hono/zod-openapi";

import { webhookClient } from "@/clients/webhook.client";

const marketingOptInUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  marketingOptIn: z.boolean(),
});

export const webhookService = {
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

  async callAccountCreated(userId: string, providerId: string): Promise<void> {
    await webhookClient.callWebhook("accountCreated", {
      userId,
      providerId,
    });
  },
};
