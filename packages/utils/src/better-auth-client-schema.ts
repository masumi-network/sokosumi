/**
 * Better Auth additional-field schema — single source of truth for Core `auth.ts`
 * and web Better Auth client field inference.
 */
export const betterAuthUserAdditionalFields = {
  termsAccepted: {
    type: "boolean",
    required: true,
    defaultValue: true,
  },
  marketingOptIn: {
    type: "boolean",
    required: true,
    defaultValue: true,
  },
  notificationsOptIn: {
    type: "boolean",
    required: false,
    defaultValue: true,
  },
  logo: {
    type: "string",
    required: false,
    defaultValue: null,
  },
  metadata: {
    type: "string",
    required: false,
    defaultValue: null,
  },
  stripeCustomerId: {
    type: "string",
    required: false,
    defaultValue: null,
    input: false,
  },
} as const;

export type BetterAuthUserAdditionalFieldKey =
  keyof typeof betterAuthUserAdditionalFields;

export const betterAuthOrganizationAdditionalFields = {
  stripeCustomerId: {
    type: "string",
    required: false,
    defaultValue: null,
    input: false,
  },
} as const;

export type BetterAuthOrganizationAdditionalFieldKey =
  keyof typeof betterAuthOrganizationAdditionalFields;
