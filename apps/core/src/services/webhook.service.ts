import { z } from "@hono/zod-openapi";

import { webhookClient } from "@/clients/webhook.client";
import { emitCoreError } from "@/lib/evlog";

const marketingOptInUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  marketingOptIn: z.boolean(),
});

export const webhookService = {
  /** Validates the user, then calls the webhook configured for `type`. */
  async callUserWebhook(
    type: "userCreated" | "userUpdated",
    user: unknown,
  ): Promise<void> {
    const { success, data, error } = marketingOptInUserSchema.safeParse(user);
    if (!success) {
      // Started in `waitUntil` after the auth response.
      emitCoreError(
        { operation: "user_webhook", userWebhook: { type } },
        {
          message: "Skipped a user webhook, because the user data is invalid",
          why: "The user has no valid id, email, name or marketing opt-in",
          fix: "Check the user row's fields named in invalidFields.",
        },
        // Paths and codes only: the values are the user's personal data.
        {
          invalidFields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        },
      );
      return;
    }

    await webhookClient.callWebhook(type, {
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
