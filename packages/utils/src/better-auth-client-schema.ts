/**
 * Better Auth additional-field schema shared by Core and web auth clients.
 * Keep in sync with `apps/core/src/lib/auth.ts` user/org additionalFields.
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

/**
 * Phantom options shape for Better Auth client plugin type inference
 * without importing the server `auth` instance.
 */
export type SokosumiBetterAuthClientOptions = {
  options: {
    user: {
      additionalFields: typeof betterAuthUserAdditionalFields;
    };
    plugins: Array<{
      id: "organization";
      schema: {
        organization: {
          additionalFields: typeof betterAuthOrganizationAdditionalFields;
        };
      };
    }>;
  };
};
