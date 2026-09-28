import { describe, expect, it } from "vitest";

import {
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  getProjectsByIdSocialPostsResponseTransformer,
  patchProjectsByIdSocialPostsByPostIdResponseTransformer,
  postProjectsByIdSocialPostsByPostIdCancelResponseTransformer,
  postProjectsByIdSocialPostsByPostIdPublishResponseTransformer,
  postProjectsByIdSocialPostsByPostIdScheduleResponseTransformer,
  postProjectsByIdSocialPostsResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

const timestamp = "2026-09-23T10:00:00.000Z";

function buildPost() {
  return {
    id: "post-1",
    projectId: "project-1",
    provider: "x",
    text: "Scheduled post",
    status: "SCHEDULED",
    scheduledAt: timestamp,
    timezone: "Europe/Prague",
    socialConnection: null,
    creator: { kind: "user", id: "user-1", name: "Ada" },
    scheduledByUserId: "user-1",
    canceledAt: null,
    publishedAt: null,
    publishedExternalId: null,
    publishedUrl: null,
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastAttempt: null,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    canEdit: true,
    canSchedule: true,
    canCancel: true,
    canPublishNow: true,
    connectionNeedsReconnect: false,
  };
}

const transformers = [
  postProjectsByIdSocialPostsResponseTransformer,
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  patchProjectsByIdSocialPostsByPostIdResponseTransformer,
  postProjectsByIdSocialPostsByPostIdScheduleResponseTransformer,
  postProjectsByIdSocialPostsByPostIdCancelResponseTransformer,
  postProjectsByIdSocialPostsByPostIdPublishResponseTransformer,
];

describe("social post response transformers", () => {
  it.each(transformers)(
    "%s accepts posts with no publishing attempt",
    async (transform) => {
      const result = await transform({
        data: buildPost(),
        meta: { timestamp, requestId: "request-1" },
      });

      expect(result.data.lastAttempt).toBeNull();
      expect(result.data.scheduledAt).toEqual(new Date(timestamp));
      expect(result.data.createdAt).toEqual(new Date(timestamp));
    },
  );

  it.each([null, timestamp])(
    "converts lists with absent and unfinished or finished attempts (%s)",
    async (finishedAt) => {
      const result = await getProjectsByIdSocialPostsResponseTransformer({
        data: [
          buildPost(),
          {
            ...buildPost(),
            lastAttempt: {
              attempt: 1,
              trigger: "scheduler",
              outcome: null,
              errorKind: null,
              providerOutcome: null,
              finishedAt,
            },
          },
        ],
        meta: { timestamp, requestId: "request-1" },
      });

      expect(result.data[0].lastAttempt).toBeNull();
      expect(result.data[1].lastAttempt?.finishedAt).toEqual(
        finishedAt ? new Date(finishedAt) : null,
      );
    },
  );
});
