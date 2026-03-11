import { describe, expect, it } from "vitest";

import {
  coworkerApiKeySchema,
  createCoworkerApiKeyResponseSchema,
} from "./coworker-api-key.schema";

describe("coworkerApiKeySchema", () => {
  it("requires name in responses even when it is null", () => {
    expect(
      coworkerApiKeySchema.safeParse({
        id: "cokey_123",
        coworkerId: "cow_123",
        keyStart: "coworker_abcdefgh",
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      coworkerApiKeySchema.safeParse({
        id: "cokey_123",
        coworkerId: "cow_123",
        name: null,
        keyStart: "coworker_abcdefgh",
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("createCoworkerApiKeyResponseSchema", () => {
  it("requires name in create responses even when it is null", () => {
    expect(
      createCoworkerApiKeyResponseSchema.safeParse({
        id: "cokey_123",
        token: "coworker_secret",
        expiresAt: null,
      }).success,
    ).toBe(false);

    expect(
      createCoworkerApiKeyResponseSchema.safeParse({
        id: "cokey_123",
        token: "coworker_secret",
        name: null,
        expiresAt: null,
      }).success,
    ).toBe(true);

    expect(
      createCoworkerApiKeyResponseSchema.safeParse({
        token: "coworker_secret",
        name: null,
        expiresAt: null,
      }).success,
    ).toBe(false);
  });
});
