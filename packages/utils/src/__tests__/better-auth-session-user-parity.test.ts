import { describe, expect, it } from "vitest";

import {
  type BetterAuthUserAdditionalFieldKey,
  betterAuthUserAdditionalFields,
} from "../better-auth-client-schema.js";
import type { SessionUser } from "../better-auth-types.js";

/** Compile-time: every inferred client field must exist on `SessionUser`. */
type AssertTrue<T extends true> = T;
type _SessionUserIncludesAllSchemaFields = AssertTrue<
  BetterAuthUserAdditionalFieldKey extends keyof SessionUser ? true : false
>;
const _sessionUserSchemaParity: _SessionUserIncludesAllSchemaFields = true;
void _sessionUserSchemaParity;

function buildSessionUserWithSchemaFields(
  overrides: Partial<SessionUser> = {},
): SessionUser {
  return {
    id: "user_1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    termsAccepted: true,
    marketingOptIn: true,
    notificationsOptIn: true,
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    ...overrides,
  };
}

describe("SessionUser vs betterAuthUserAdditionalFields", () => {
  it("lists the same user additional-field keys as the client schema", () => {
    const user = buildSessionUserWithSchemaFields();
    const schemaKeys = Object.keys(
      betterAuthUserAdditionalFields,
    ) as BetterAuthUserAdditionalFieldKey[];

    expect(schemaKeys.length).toBeGreaterThan(0);

    for (const key of schemaKeys) {
      expect(user).toHaveProperty(key);
    }
  });

  it("does not expose onboardingCompleted as an additional field", () => {
    expect(Object.keys(betterAuthUserAdditionalFields)).not.toContain(
      "onboardingCompleted",
    );
    expect(buildSessionUserWithSchemaFields()).not.toHaveProperty(
      "onboardingCompleted",
    );
  });

  it("allows admin role on SessionUser without a schema entry", () => {
    const user = buildSessionUserWithSchemaFields({ role: "admin" });

    expect(user.role).toBe("admin");
  });
});
