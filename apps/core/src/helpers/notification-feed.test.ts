import {
  CoworkerWorkspaceAccessStatus,
  NotificationKind,
  VendorGrantStatus,
} from "@sokosumi/database";
import {
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGES_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  excludeResolvedCoworkerAccessNotificationsWhere,
  excludeResolvedVendorGrantNotificationsWhere,
  findStaleCoworkerAccessNotificationReferenceIds,
  findStaleVendorGrantNotificationReferenceIds,
  mergeAccessNotificationExclusions,
  notificationFeedWhere,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "./notification-feed";

const notificationFindManyMock = vi.fn();
const vendorGrantFindManyMock = vi.fn();
const coworkerWorkspaceAccessFindManyMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    notification: {
      findMany: (...args: unknown[]) => notificationFindManyMock(...args),
    },
    vendorGrant: {
      findMany: (...args: unknown[]) => vendorGrantFindManyMock(...args),
    },
    coworkerWorkspaceAccess: {
      findMany: (...args: unknown[]) =>
        coworkerWorkspaceAccessFindManyMock(...args),
    },
  },
}));

const FEED_OR = [
  { kind: { notIn: [NotificationKind.CHAT] } },
  {
    kind: { in: [NotificationKind.CHAT] },
    messageKey: {
      in: [CHAT_ROOM_MESSAGE_MESSAGE_KEY, CHAT_ROOM_MESSAGES_MESSAGE_KEY],
    },
  },
];

describe("notificationFeedWhere", () => {
  it("keeps a mention out of the default in-app feed and lets a room message in", () => {
    expect(notificationFeedWhere()).toEqual({
      inApp: true,
      OR: FEED_OR,
    });
  });

  /**
   * The rule is not replaced by the request. A reader asking for CHAT is asking
   * for the chat rows the feed has, which is the room messages, and a mention
   * named explicitly is still a mention.
   */
  it("narrows a requested kind on top of the rule", () => {
    expect(
      notificationFeedWhere([
        NotificationKind.JOB,
        NotificationKind.CHAT,
        NotificationKind.TASK,
      ]),
    ).toEqual({
      inApp: true,
      kind: {
        in: [
          NotificationKind.JOB,
          NotificationKind.CHAT,
          NotificationKind.TASK,
        ],
      },
      OR: FEED_OR,
    });
  });

  it("answers a request for CHAT with the room messages", () => {
    expect(notificationFeedWhere([NotificationKind.CHAT])).toEqual({
      inApp: true,
      kind: { in: [NotificationKind.CHAT] },
      OR: FEED_OR,
    });
  });

  it("keeps non-chat kinds as an explicit in filter", () => {
    expect(
      notificationFeedWhere([NotificationKind.JOB, NotificationKind.SYSTEM]),
    ).toEqual({
      inApp: true,
      kind: { in: [NotificationKind.JOB, NotificationKind.SYSTEM] },
      OR: FEED_OR,
    });
  });

  /**
   * A notification the reader silenced in the app is written but never shown,
   * so every feed read has to exclude it. Asserted on its own, because it is
   * the one clause a new call site is most likely to leave out.
   */
  it("hides a notification the reader silenced in the app, whatever the kinds", () => {
    expect(notificationFeedWhere()).toMatchObject({ inApp: true });
    expect(notificationFeedWhere([NotificationKind.JOB])).toMatchObject({
      inApp: true,
    });
  });
});

describe("excludeResolvedVendorGrantNotificationsWhere", () => {
  it("is a no-op when there are no stale grant reference ids", () => {
    expect(excludeResolvedVendorGrantNotificationsWhere([])).toEqual({});
  });

  it("excludes pending-vendor-grant notifications for resolved grant ids", () => {
    expect(
      excludeResolvedVendorGrantNotificationsWhere(["grant_1", "grant_2"]),
    ).toEqual({
      NOT: {
        AND: [
          { messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY },
          { referenceId: { in: ["grant_1", "grant_2"] } },
        ],
      },
    });
  });
});

describe("findStaleVendorGrantNotificationReferenceIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns grant ids whose notifications are still pending but grants are not", async () => {
    notificationFindManyMock.mockResolvedValue([
      { referenceId: "grant_pending" },
      { referenceId: "grant_granted" },
      { referenceId: "grant_denied" },
      { referenceId: "grant_granted" },
    ]);
    vendorGrantFindManyMock.mockResolvedValue([
      { id: "grant_pending", status: VendorGrantStatus.PENDING },
    ]);

    await expect(
      findStaleVendorGrantNotificationReferenceIds("user_1"),
    ).resolves.toEqual(["grant_granted", "grant_denied"]);

    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
      },
      select: { referenceId: true },
    });
    expect(vendorGrantFindManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["grant_pending", "grant_granted", "grant_denied"],
        },
      },
      select: { id: true, status: true },
    });
  });

  it("treats missing grants as stale", async () => {
    notificationFindManyMock.mockResolvedValue([
      { referenceId: "missing_grant" },
    ]);
    vendorGrantFindManyMock.mockResolvedValue([]);

    await expect(
      findStaleVendorGrantNotificationReferenceIds("user_1"),
    ).resolves.toEqual(["missing_grant"]);
  });

  it("returns empty when the user has no vendor-grant notifications", async () => {
    notificationFindManyMock.mockResolvedValue([]);

    await expect(
      findStaleVendorGrantNotificationReferenceIds("user_1"),
    ).resolves.toEqual([]);
    expect(vendorGrantFindManyMock).not.toHaveBeenCalled();
  });
});

describe("excludeResolvedCoworkerAccessNotificationsWhere", () => {
  it("is a no-op when there are no stale access reference ids", () => {
    expect(excludeResolvedCoworkerAccessNotificationsWhere([])).toEqual({});
  });

  it("excludes pending-coworker-access notifications for resolved access ids", () => {
    expect(
      excludeResolvedCoworkerAccessNotificationsWhere(["access_1", "access_2"]),
    ).toEqual({
      NOT: {
        AND: [
          { messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY },
          { referenceId: { in: ["access_1", "access_2"] } },
        ],
      },
    });
  });
});

describe("findStaleCoworkerAccessNotificationReferenceIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns access ids whose notifications are still pending but access is not", async () => {
    notificationFindManyMock.mockResolvedValue([
      { referenceId: "access_pending" },
      { referenceId: "access_granted" },
      { referenceId: "access_denied" },
      { referenceId: "access_granted" },
    ]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([
      {
        id: "access_pending",
        status: CoworkerWorkspaceAccessStatus.PENDING,
      },
    ]);

    await expect(
      findStaleCoworkerAccessNotificationReferenceIds("user_1"),
    ).resolves.toEqual(["access_granted", "access_denied"]);

    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      },
      select: { referenceId: true },
    });
    expect(coworkerWorkspaceAccessFindManyMock).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["access_pending", "access_granted", "access_denied"],
        },
      },
      select: { id: true, status: true },
    });
  });

  it("treats missing access rows as stale", async () => {
    notificationFindManyMock.mockResolvedValue([
      { referenceId: "missing_access" },
    ]);
    coworkerWorkspaceAccessFindManyMock.mockResolvedValue([]);

    await expect(
      findStaleCoworkerAccessNotificationReferenceIds("user_1"),
    ).resolves.toEqual(["missing_access"]);
  });

  it("returns empty when the user has no coworker-access notifications", async () => {
    notificationFindManyMock.mockResolvedValue([]);

    await expect(
      findStaleCoworkerAccessNotificationReferenceIds("user_1"),
    ).resolves.toEqual([]);
    expect(coworkerWorkspaceAccessFindManyMock).not.toHaveBeenCalled();
  });
});

describe("mergeAccessNotificationExclusions", () => {
  it("returns empty when all clauses are empty", () => {
    expect(mergeAccessNotificationExclusions({}, {})).toEqual({});
  });

  it("returns a single non-empty clause flat", () => {
    const clause = excludeResolvedVendorGrantNotificationsWhere(["g1"]);
    expect(mergeAccessNotificationExclusions({}, clause, {})).toEqual(clause);
  });

  it("AND-combines multiple non-empty clauses", () => {
    const vendor = excludeResolvedVendorGrantNotificationsWhere(["g1"]);
    const coworker = excludeResolvedCoworkerAccessNotificationsWhere(["a1"]);
    expect(mergeAccessNotificationExclusions(vendor, coworker)).toEqual({
      AND: [vendor, coworker],
    });
  });
});
