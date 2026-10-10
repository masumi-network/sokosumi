import { describe, expect, it } from "vitest";

import {
  refreshSocialAccountStatisticsRequestSchema,
  socialAccountPostSchema,
  socialAccountStatisticsQuerySchema,
  socialSyncReadModelSchema,
} from "./social-account-statistics.schema";

const sync = {
  status: "fresh" as const,
  dataFetchedAt: null,
  headFetchedAt: null,
  dataVersion: "",
  mayAutoRequest: false,
  lastError: null,
  partialWarnings: [],
};

describe("socialSyncReadModelSchema", () => {
  it("accepts every sync status the UI reads", () => {
    for (const status of [
      "fresh",
      "stale",
      "queued",
      "running",
      "reauth_required",
      "partial",
    ] as const) {
      expect(
        socialSyncReadModelSchema.safeParse({ ...sync, status }).success,
      ).toBe(true);
    }
  });

  it("rejects a status the UI does not know", () => {
    expect(
      socialSyncReadModelSchema.safeParse({
        ...sync,
        status: "reauthorization_required",
      }).success,
    ).toBe(false);
  });
});

describe("socialAccountStatisticsQuerySchema", () => {
  it("requires a UUID cursor, unlike the post-statistics query", () => {
    expect(
      socialAccountStatisticsQuerySchema.safeParse({
        cursor: "cmi4gmksz000104l8wps8p7fp",
      }).success,
    ).toBe(false);
    expect(
      socialAccountStatisticsQuerySchema.safeParse({
        cursor: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed connection id", () => {
    expect(
      socialAccountStatisticsQuerySchema.safeParse({
        connectionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("socialAccountPostSchema", () => {
  const post = {
    id: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    provider: "x",
    externalId: "123",
    text: "Hello",
    publishedAt: null,
    url: "https://x.com/launch/status/123",
    metrics: {
      views: 1,
      impressions: 1,
      likes: 1,
      comments: 0,
      shares: 0,
      saves: null,
    },
    additionalMetrics: [],
    fetchedAt: "2026-10-08T12:00:00.000Z",
  };

  it("rejects a non-http post url", () => {
    expect(
      socialAccountPostSchema.safeParse({
        ...post,
        url: "ftp://example.com/post",
      }).success,
    ).toBe(false);
  });

  it("accepts a missing public url", () => {
    expect(
      socialAccountPostSchema.safeParse({ ...post, url: null }).success,
    ).toBe(true);
  });
});

describe("refreshSocialAccountStatisticsRequestSchema", () => {
  it("rejects unknown fields", () => {
    expect(
      refreshSocialAccountStatisticsRequestSchema.safeParse({
        continueHistory: true,
        force: true,
      }).success,
    ).toBe(false);
  });
});
