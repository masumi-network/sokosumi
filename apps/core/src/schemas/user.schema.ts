import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { subscriptionSchema } from "@/schemas/subscription.schema";

const creditBucketBreakdownItemSchema = z
  .object({
    total: z.number().openapi({
      description: "Original bucket amount in credits",
      example: 50,
    }),
    remaining: z.number().openapi({
      description:
        "Remaining balance in this bucket after prior consumption (same order as debits)",
      example: 32.5,
    }),
    expiresAt: dateTimeSchema.nullable().openapi({
      description: "When this bucket expires; null if it does not expire",
      example: "2026-07-01T00:00:00.000Z",
    }),
  })
  .openapi("CreditBucketBreakdown");

/** Rollup of non-subscription credits (sums over `extra.buckets` lines). */
const creditsResponseExtraCreditsSchema = z
  .object({
    total: z.number().openapi({
      description:
        "Sum of original amounts granted across non-subscription buckets listed in `extra.buckets`",
      example: 25,
    }),
    remaining: z.number().openapi({
      description:
        "Sum of remaining balances across those buckets (matches sum of each line’s `remaining`)",
      example: 12.5,
    }),
    used: z.number().openapi({
      description:
        "Sum of credits already consumed from those buckets (`total` − `remaining` per line, summed)",
      example: 12.5,
    }),
  })
  .openapi("CreditsResponseExtraCredits");

const creditsResponseEnterpriseSchema = z.object({
  credits: creditsResponseExtraCreditsSchema.openapi({
    description:
      "Enterprise contract pool rollup (ENTERPRISE_PERIOD and ENTERPRISE_TOP_UP buckets)",
  }),
  buckets: z.array(creditBucketBreakdownItemSchema).openapi({
    description:
      "Enterprise pool buckets with remaining balance for the assigned member",
  }),
});

const creditsResponseExtraSchema = z
  .object({
    credits: creditsResponseExtraCreditsSchema.openapi({
      description:
        "Non-subscription credit rollup excluding subscription-period and enterprise pool buckets",
    }),
    buckets: z.array(creditBucketBreakdownItemSchema).openapi({
      description:
        "Non-subscription buckets with remaining balance (subscription-period and enterprise pool buckets omitted). Order: earliest expiresAt (non-expiring last), then smallest original allocation, then oldest createdAt, then id",
    }),
    enterprise: creditsResponseEnterpriseSchema.nullable().openapi({
      description:
        "Enterprise contract shared pool for assigned members; null when not applicable",
    }),
  })
  .openapi("CreditsResponseExtra");

/** Nested shape mirrored under deprecated `credits` */
const creditsDeprecatedMirrorSchema = z.object({
  subscription: subscriptionSchema.nullable(),
  buffer: z.number().openapi({
    description:
      "Current available credit balance excluding subscription-period and enterprise pool buckets (see extra.enterprise for pool)",
    example: 25.0,
  }),
  total: z.number().openapi({
    description:
      "Current available total credit balance (buffer plus remaining subscription credits)",
    example: 82.5,
  }),
});

export const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    name: z.string().openapi({ example: "John Doe" }),
    email: z.email().openapi({ example: "john.doe@example.com" }),
    emailVerified: z.boolean().openapi({ example: true }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/image.png" }),
    role: z.string().openapi({ example: "user" }),
  })
  .openapi("User");

export const userSummarySchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/avatar.png" }),
  })
  .openapi("UserSummary");

export type User = z.infer<typeof userSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userPreferencesResponseSchema = z.object({
  marketingOptIn: z.boolean().openapi({
    description: "Whether the user wants to receive marketing emails",
    example: true,
  }),
  notificationsOptIn: z.boolean().openapi({
    description: "Whether the user wants to receive job status notifications",
    example: true,
  }),
});

export const userOnboardingResponseSchema = z.object({
  completed: z.boolean().openapi({
    description: "Whether the user has completed onboarding",
    example: true,
  }),
});

export const userOnboardingStatusResponseSchema = z.object({
  show: z.boolean().openapi({
    description: "Whether the onboarding flow should be shown",
    example: true,
  }),
  completed: z.boolean().openapi({
    description: "Whether the user has completed onboarding",
    example: false,
  }),
});

export const preferredOrganizationResponseSchema = z.object({
  organizationId: z.string().nullable().openapi({
    description: "Preferred organization id for the session user",
    example: "org_123",
  }),
});

export const checkEmailsRequestSchema = z
  .object({
    emails: z
      .array(z.email())
      .max(100)
      .openapi({
        description: "Email addresses to check for existing user accounts",
        example: ["jane@example.com", "john@example.com"],
      }),
  })
  .openapi("CheckEmailsRequest");

export const checkEmailsResponseSchema = z.object({
  existingEmails: z.array(z.email()).openapi({
    description: "Emails that already have user accounts",
    example: ["jane@example.com"],
  }),
});

export const userSubscriptionResponseSchema = z.object({
  subscription: subscriptionSchema.nullable(),
});

export const utmAttributionRequestSchema = z
  .object({
    utm_source: z.string().min(1).max(255).openapi({
      description: "Campaign source (e.g. utm_source)",
      example: "google",
    }),
    utm_medium: z.string().max(255).optional().openapi({
      description: "Campaign medium (e.g. utm_medium)",
      example: "cpc",
    }),
    utm_campaign: z.string().max(255).optional().openapi({
      description: "Campaign name (e.g. utm_campaign)",
      example: "spring_launch",
    }),
    utm_term: z.string().max(255).optional().openapi({
      description: "Paid keyword term (e.g. utm_term)",
      example: "ai agents",
    }),
    utm_content: z.string().max(255).optional().openapi({
      description: "Content/creative variant (e.g. utm_content)",
      example: "hero_cta",
    }),
    referrer: z.string().max(255).optional().openapi({
      description: "Referring URL captured on landing",
      example: "https://example.com",
    }),
    landingPage: z.string().max(255).optional().openapi({
      description: "First page the visitor landed on",
      example: "https://sokosumi.com/",
    }),
    capturedAt: dateTimeSchema.openapi({
      description: "When the UTM data was captured on the client",
    }),
  })
  .openapi("UtmAttributionRequest");

export const utmAttributionResponseSchema = z
  .object({
    id: z.string().openapi({
      description: "Identifier of the created UTM attribution record",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    convertedAt: dateTimeSchema.openapi({
      description: "When the attribution was recorded against the user",
    }),
  })
  .openapi("UtmAttributionResponse");

export const creditsResponseSchema = z.object({
  subscription: subscriptionSchema.nullable().openapi({
    description:
      "Active subscription and period credit breakdown for the billing context",
  }),
  extra: creditsResponseExtraSchema.openapi({
    description:
      "`extra.credits`: non-subscription totals (sums over `extra.buckets`). `extra.buckets`: per-bucket lines.",
  }),
  credits: creditsDeprecatedMirrorSchema.openapi({
    deprecated: true,
    description:
      "Deprecated: prefer top-level `subscription`. Still includes `buffer` for non-subscription balance; `subscription` and `total` mirror the canonical fields for backward compatibility (`total` is current available total: buffer plus remaining subscription credits).",
  }),
});
