/**
 * Better Auth additional-field schemas shared between the core auth instance
 * (server config) and the web auth client (`inferAdditionalFields` /
 * `inferOrgAdditionalFields` runtime form), so both sides always agree on the
 * custom user/organization fields.
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
  },
  onboardingCompleted: {
    type: "boolean",
    required: true,
    defaultValue: false,
  },
} as const;

export const betterAuthOrganizationAdditionalFields = {
  stripeCustomerId: {
    type: "string",
    required: false,
    defaultValue: null,
    input: false,
  },
} as const;
