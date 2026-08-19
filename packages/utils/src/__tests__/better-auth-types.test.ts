import { describe, expect, it } from "vitest";

import type { Account, Session, SessionUser } from "../better-auth-types.js";

describe("better-auth-types", () => {
  it("accepts a minimal Core-shaped session", () => {
    const session: Session = {
      session: {
        id: "sess_1",
        userId: "user_1",
        expiresAt: "2026-01-01T00:00:00.000Z",
        token: "token",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        activeOrganizationId: null,
      },
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        termsAccepted: true,
        marketingOptIn: false,
      },
    };

    expect(session.user.id).toBe("user_1");
    expect(session.session.activeOrganizationId).toBeNull();
    expect(session.user).not.toHaveProperty("onboardingCompleted");
  });

  it("accepts session user with optional admin role", () => {
    const user: SessionUser = {
      id: "user_1",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: true,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      termsAccepted: true,
      marketingOptIn: true,
      role: "admin",
    };

    expect(user.role).toBe("admin");
    expect(user).not.toHaveProperty("onboardingCompleted");
  });

  it("does not include onboardingCompleted on SessionUser", () => {
    type HasOnboardingCompleted =
      "onboardingCompleted" extends keyof SessionUser ? true : false;
    const hasOnboardingCompleted: HasOnboardingCompleted = false;
    expect(hasOnboardingCompleted).toBe(false);
  });

  it("accepts a linked OAuth account", () => {
    const account: Account = {
      id: "acc_1",
      providerId: "google",
      accountId: "google-sub",
      issuer: "https://accounts.google.com",
      userId: "user_1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    expect(account.providerId).toBe("google");
    expect(account.issuer).toBe("https://accounts.google.com");
  });
});
