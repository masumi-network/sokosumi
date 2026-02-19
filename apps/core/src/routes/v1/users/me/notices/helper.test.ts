import { describe, expect, it } from "vitest";

import {
  filterPendingNotices,
  getAcknowledgmentState,
  getNoticeIneligibilityReason,
  type NoticeRecord,
} from "./helper";

const BASE_USER_CREATED_AT = new Date("2026-02-01T00:00:00.000Z");
const BASE_NOW = new Date("2026-02-20T12:00:00.000Z");

function createNotice(
  id: string,
  overrides: Partial<NoticeRecord> = {},
): NoticeRecord {
  return {
    id,
    bodyMarkdown: `# ${id}`,
    effectiveAt: new Date("2026-02-10T00:00:00.000Z"),
    isActive: true,
    createdAt: new Date("2026-02-09T00:00:00.000Z"),
    updatedAt: new Date("2026-02-09T00:00:00.000Z"),
    ...overrides,
  };
}

describe("filterPendingNotices", () => {
  it("returns empty when there are no notices", () => {
    const result = filterPendingNotices({
      notices: [],
      userCreatedAt: BASE_USER_CREATED_AT,
      acknowledgedNoticeIds: [],
      now: BASE_NOW,
    });

    expect(result).toEqual([]);
  });

  it("excludes notices that are not effective yet", () => {
    const result = filterPendingNotices({
      notices: [
        createNotice("future", {
          effectiveAt: new Date("2026-02-21T00:00:00.000Z"),
        }),
      ],
      userCreatedAt: BASE_USER_CREATED_AT,
      acknowledgedNoticeIds: [],
      now: BASE_NOW,
    });

    expect(result).toEqual([]);
  });

  it("excludes inactive notices", () => {
    const result = filterPendingNotices({
      notices: [
        createNotice("inactive", {
          isActive: false,
        }),
      ],
      userCreatedAt: BASE_USER_CREATED_AT,
      acknowledgedNoticeIds: [],
      now: BASE_NOW,
    });

    expect(result).toEqual([]);
  });

  it("excludes notices for users created at or after effectiveAt", () => {
    const effectiveAt = new Date("2026-02-15T00:00:00.000Z");
    const result = filterPendingNotices({
      notices: [
        createNotice("new-user", {
          effectiveAt,
        }),
      ],
      userCreatedAt: new Date("2026-02-15T00:00:00.000Z"),
      acknowledgedNoticeIds: [],
      now: BASE_NOW,
    });

    expect(result).toEqual([]);
  });

  it("excludes already acknowledged notices", () => {
    const result = filterPendingNotices({
      notices: [createNotice("acknowledged"), createNotice("pending")],
      userCreatedAt: BASE_USER_CREATED_AT,
      acknowledgedNoticeIds: ["acknowledged"],
      now: BASE_NOW,
    });

    expect(result.map((notice) => notice.id)).toEqual(["pending"]);
  });

  it("returns multiple eligible notices in oldest-first order", () => {
    const oldest = createNotice("oldest", {
      effectiveAt: new Date("2026-02-03T00:00:00.000Z"),
      createdAt: new Date("2026-02-03T01:00:00.000Z"),
    });
    const oldestSameEffectiveAt = createNotice("oldest-same-effective-at", {
      effectiveAt: new Date("2026-02-03T00:00:00.000Z"),
      createdAt: new Date("2026-02-03T02:00:00.000Z"),
    });
    const newer = createNotice("newer", {
      effectiveAt: new Date("2026-02-04T00:00:00.000Z"),
      createdAt: new Date("2026-02-04T00:00:00.000Z"),
    });

    const result = filterPendingNotices({
      notices: [newer, oldestSameEffectiveAt, oldest],
      userCreatedAt: BASE_USER_CREATED_AT,
      acknowledgedNoticeIds: [],
      now: BASE_NOW,
    });

    expect(result.map((notice) => notice.id)).toEqual([
      "oldest",
      "oldest-same-effective-at",
      "newer",
    ]);
  });
});

describe("getNoticeIneligibilityReason", () => {
  it("returns null when notice is acknowledgeable", () => {
    const reason = getNoticeIneligibilityReason(
      createNotice("eligible"),
      BASE_USER_CREATED_AT,
      BASE_NOW,
    );

    expect(reason).toBeNull();
  });

  it("returns inactive reason", () => {
    const reason = getNoticeIneligibilityReason(
      createNotice("inactive", { isActive: false }),
      BASE_USER_CREATED_AT,
      BASE_NOW,
    );

    expect(reason).toBe("Notice is not active");
  });

  it("returns not effective reason", () => {
    const reason = getNoticeIneligibilityReason(
      createNotice("future", {
        effectiveAt: new Date("2026-02-21T00:00:00.000Z"),
      }),
      BASE_USER_CREATED_AT,
      BASE_NOW,
    );

    expect(reason).toBe("Notice is not effective yet");
  });

  it("returns not applicable reason", () => {
    const reason = getNoticeIneligibilityReason(
      createNotice("new-user", {
        effectiveAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
      new Date("2026-02-15T00:00:00.000Z"),
      BASE_NOW,
    );

    expect(reason).toBe("Notice is not applicable to this user");
  });
});

describe("getAcknowledgmentState", () => {
  it("returns alreadyAcknowledged false when acknowledgment does not exist", () => {
    const now = new Date("2026-02-20T09:05:00.000Z");
    const state = getAcknowledgmentState(null, now);

    expect(state).toEqual({
      acknowledgedAt: now,
      alreadyAcknowledged: false,
    });
  });

  it("returns alreadyAcknowledged true when acknowledgment already exists", () => {
    const existingAcknowledgedAt = new Date("2026-02-20T08:00:00.000Z");
    const state = getAcknowledgmentState(
      existingAcknowledgedAt,
      new Date("2026-02-20T09:05:00.000Z"),
    );

    expect(state).toEqual({
      acknowledgedAt: existingAcknowledgedAt,
      alreadyAcknowledged: true,
    });
  });
});
