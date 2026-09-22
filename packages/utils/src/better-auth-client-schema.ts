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
  // The sidebar's unread message count is shown unless the reader switched it
  // off (ADR-0038). Stored as "hide" so false, which every reader holds, means
  // shown.
  hideRoomUnreadCount: {
    type: "boolean",
    required: false,
    defaultValue: false,
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
