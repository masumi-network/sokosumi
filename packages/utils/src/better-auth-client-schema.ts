import * as z from "zod";

// Core auth hooks validate the combined length with the other name part.
const namePartInputSchema = z.string().trim().min(1).nullable();

/**
 * Better Auth additional-field schema — single source of truth for Core `auth.ts`
 * and web Better Auth client field inference.
 */
export const betterAuthUserAdditionalFields = {
  // Null means "not given": social and sign-in-page email-code sign-ups create the user
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

/**
 * Set to `true` on a `/sign-in/email-otp` response when the code removed the
 * account's password and Google or Microsoft links: Better Auth does that when
 * the address was unproven. Core sets it, the sign-in page tells the person.
 */
export const EMAIL_CODE_SIGN_IN_METHODS_REMOVED = "signInMethodsRemoved";
