import * as z from "zod";

const namePartInputSchema = z.string().trim().min(1).max(64).nullable();

/**
 * Better Auth additional-field schema — single source of truth for Core `auth.ts`
 * and web Better Auth client field inference.
 */
export const betterAuthUserAdditionalFields = {
  // Null means "not given": magic-link and social sign-ups create the user
  // before anyone is asked, and users from before these fields never were.
  // An empty string is never stored. Email sign-up requires both and derives
  // the initial display `name` from them.
  firstName: {
    type: "string",
    required: false,
    defaultValue: null,
    validator: { input: namePartInputSchema },
  },
  lastName: {
    type: "string",
    required: false,
    defaultValue: null,
    validator: { input: namePartInputSchema },
  },
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
