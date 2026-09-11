import type { Account } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { canReauthenticateWith, isSocialProvider } from "./social-providers";

function account(providerId: string): Account {
  return {
    accountId: `${providerId}-account`,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: `account-${providerId}`,
    providerId,
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId: "user-1",
  };
}

describe("isSocialProvider", () => {
  it("accepts only the providers the app offers", () => {
    expect(isSocialProvider("google")).toBe(true);
    expect(isSocialProvider("microsoft")).toBe(true);
    expect(isSocialProvider("credential")).toBe(false);
    expect(isSocialProvider("apple")).toBe(false);
  });
});

describe("canReauthenticateWith", () => {
  it("is true for a password or a supported provider", () => {
    expect(canReauthenticateWith([account("credential")])).toBe(true);
    expect(canReauthenticateWith([account("google")])).toBe(true);
    expect(canReauthenticateWith([account("microsoft")])).toBe(true);
  });

  it("is false with no accounts or only an unsupported provider", () => {
    expect(canReauthenticateWith([])).toBe(false);
    expect(canReauthenticateWith([account("apple")])).toBe(false);
  });
});
