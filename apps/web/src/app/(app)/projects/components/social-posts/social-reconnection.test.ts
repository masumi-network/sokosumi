import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { getSocialReconnections } from "./social-reconnection";

const connection: ProjectSocialConnection = {
  id: "account-1",
  provider: "x",
  status: "active",
  externalHandle: "sokosumi",
  displayName: null,
  avatarUrl: null,
  subscriptionType: null,
  connectedAt: new Date("2026-09-01"),
  disconnectedAt: null,
};
function post(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    projectId: "project-1",
    provider: "x",
    text: "Hello",
    firstComment: null,
    media: [],
    status: "FAILED",
    socialConnection: connection,
    creator: { kind: "user", id: "user-1", name: "Alice" },
    scheduledAt: null,
    timezone: null,
    scheduledByUserId: null,
    canceledAt: null,
    publishedAt: null,
    publishedExternalId: null,
    publishedUrl: null,
    lastError: null,
    attemptCount: 1,
    nextAttemptAt: null,
    lastAttemptAt: new Date("2026-10-01"),
    lastAttempt: null,
    revision: 1,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-10-01"),
    canEdit: true,
    canSchedule: true,
    canCancel: true,
    canPublishNow: true,
    canDuplicate: true,
    canApprove: false,
    canReject: false,
    connectionNeedsReconnect: false,
    ...overrides,
  };
}

describe("getSocialReconnections", () => {
  it("shows expired accounts before any post fails", () => {
    expect(
      getSocialReconnections(
        [{ ...connection, status: "reauthorization_required" }],
        [],
      ),
    ).toEqual([
      {
        connection: { ...connection, status: "reauthorization_required" },
        affectedPosts: [],
      },
    ]);
  });
  it.each([
    { lastError: "Social connection needs reconnecting" },
    {
      lastAttempt: {
        attempt: 1,
        trigger: "scheduler",
        outcome: "failed_permanent",
        errorKind: "unauthorized",
        providerOutcome: null,
        finishedAt: new Date("2026-10-01"),
      },
    },
    {
      lastAttempt: {
        attempt: 1,
        trigger: "scheduler",
        outcome: "authorization_revoked",
        errorKind: null,
        providerOutcome: null,
        finishedAt: new Date("2026-10-01"),
      },
    },
  ] satisfies Partial<SocialPost>[])(
    "detects broken authorization: %j",
    (flags) => {
      const failed = post(flags);
      const scheduled = post({ id: "scheduled", status: "SCHEDULED" });
      expect(
        getSocialReconnections(
          [connection],
          [
            failed,
            scheduled,
            post({ status: "DRAFT" }),
            post({ status: "PUBLISHED" }),
            post({ status: "CANCELED" }),
            post({ socialConnection: null }),
          ],
        )[0]?.affectedPosts,
      ).toEqual([failed, scheduled]);
    },
  );
  it.each([401, 403])(
    "counts classified X media-upload %s failures",
    (status) => {
      const failed = post({
        lastError: `upload X image failed (${status})`,
        lastAttempt: {
          attempt: 1,
          trigger: "scheduler",
          outcome: "failed_permanent",
          errorKind: "unauthorized",
          providerOutcome: null,
          finishedAt: new Date("2026-10-01"),
        },
      });
      expect(
        getSocialReconnections([connection], [failed])[0]?.affectedPosts,
      ).toEqual([failed]);
    },
  );
  it("counts scheduled and unauthorized failures only on the affected account", () => {
    const unauthorized = post({
      lastAttempt: {
        attempt: 1,
        trigger: "scheduler",
        outcome: "failed_permanent",
        errorKind: "unauthorized",
        providerOutcome: null,
        finishedAt: new Date("2026-10-01"),
      },
    });
    const scheduled = post({ id: "scheduled", status: "SCHEDULED" });
    expect(
      getSocialReconnections(
        [{ ...connection, status: "reauthorization_required" }],
        [
          unauthorized,
          scheduled,
          post({
            id: "bad-media",
            connectionNeedsReconnect: true,
            lastError: "upload X image failed (400)",
          }),
          post({
            id: "missed",
            status: "MISSED",
            connectionNeedsReconnect: true,
          }),
          post({
            id: "other-account",
            socialConnection: { ...connection, id: "other" },
            lastError: "Social connection needs reconnecting",
          }),
        ],
      )[0]?.affectedPosts,
    ).toEqual([unauthorized, scheduled]);
  });
  it("ignores pending, disconnected, healthy accounts and unrelated failures", () => {
    expect(
      getSocialReconnections(
        [
          connection,
          { ...connection, status: "pending" },
          { ...connection, status: "disconnected" },
        ],
        [post({ lastError: "Duplicate content" })],
      ),
    ).toEqual([]);
  });
  it("clears old authorization failures after reconnect", () => {
    expect(
      getSocialReconnections(
        [{ ...connection, connectedAt: new Date("2026-10-02") }],
        [post({ connectionNeedsReconnect: true })],
      ),
    ).toEqual([]);
  });
  it("does not clear failures that happened after reconnect", () => {
    expect(
      getSocialReconnections(
        [{ ...connection, connectedAt: new Date("2026-09-30") }],
        [post({ connectionNeedsReconnect: true })],
      ),
    ).toHaveLength(1);
  });
});
