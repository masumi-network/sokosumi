import {
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  getProjectsByIdSocialPostsResponseTransformer,
  patchProjectsByIdSocialPostsByPostIdResponseTransformer,
  postProjectsByIdSocialAccountPostsByAccountPostIdRecycleResponseTransformer,
  postProjectsByIdSocialPostsByPostIdApproveResponseTransformer,
  postProjectsByIdSocialPostsByPostIdCancelResponseTransformer,
  postProjectsByIdSocialPostsByPostIdDuplicateResponseTransformer,
  postProjectsByIdSocialPostsByPostIdPublishResponseTransformer,
  postProjectsByIdSocialPostsByPostIdRejectResponseTransformer,
  postProjectsByIdSocialPostsByPostIdScheduleResponseTransformer,
  postProjectsByIdSocialPostsByPostIdThreadResumeResponseTransformer,
  postProjectsByIdSocialPostsResponseTransformer,
} from "@sokosumi/core-client/transformers";
import { describe, expect, it } from "vitest";

const timestamp = "2026-09-23T10:00:00.000Z";

function buildPost() {
  return {
    id: "post-1",
    projectId: "project-1",
    provider: "x",
    text: "Scheduled post",
    firstComment: null,
    media: [],
    threadParts: [],
    threadPartCount: 1,
    publishedThreadPartCount: 0,
    failedThreadPartPosition: null,
    partiallyPublished: false,
    quotedPostId: null,
    quotedPost: null,
    needsAttentionReason: null,
    publishingThreadPartPosition: null,
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
    canApprove: false,
    canReject: false,
    canDuplicate: false,
    connectionNeedsReconnect: false,
  };
}

const transformers = [
  postProjectsByIdSocialPostsResponseTransformer,
  getProjectsByIdSocialPostsByPostIdResponseTransformer,
  patchProjectsByIdSocialPostsByPostIdResponseTransformer,
  postProjectsByIdSocialPostsByPostIdScheduleResponseTransformer,
  postProjectsByIdSocialPostsByPostIdThreadResumeResponseTransformer,
  postProjectsByIdSocialPostsByPostIdCancelResponseTransformer,
  postProjectsByIdSocialPostsByPostIdDuplicateResponseTransformer,
  postProjectsByIdSocialAccountPostsByAccountPostIdRecycleResponseTransformer,
  postProjectsByIdSocialPostsByPostIdPublishResponseTransformer,
  postProjectsByIdSocialPostsByPostIdApproveResponseTransformer,
  postProjectsByIdSocialPostsByPostIdRejectResponseTransformer,
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
      expect(result.data.timezone).toBe("Europe/Prague");
    },
  );

  it("revives a resumed thread's published parts without losing unpublished parts", async () => {
    const result =
      await postProjectsByIdSocialPostsByPostIdThreadResumeResponseTransformer({
        data: {
          ...buildPost(),
          status: "FAILED",
          threadPartCount: 3,
          publishedThreadPartCount: 2,
          partiallyPublished: true,
          threadParts: [
            {
              id: "part-2",
              position: 2,
              text: "Posted",
              media: [],
              externalPostId: "second-id",
              publishedAt: timestamp,
              error: null,
            },
            {
              id: "part-3",
              position: 3,
              text: "Not posted",
              media: [],
              externalPostId: null,
              publishedAt: null,
              error: "Failed",
            },
          ],
        },
        meta: { timestamp, requestId: "request-1" },
      });
    expect(result.data.threadParts[0].publishedAt).toEqual(new Date(timestamp));
    expect(result.data.threadParts[1].publishedAt).toBeNull();
    expect(result.data.publishingThreadPartPosition).toBeNull();
    expect(result.data.threadParts[0].externalPostId).toBe("second-id");
  });

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
