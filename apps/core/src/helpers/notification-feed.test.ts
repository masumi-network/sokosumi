import {
  CoworkerWorkspaceAccessStatus,
  NotificationKind,
  VendorGrantStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  excludeResolvedCoworkerAccessNotificationsWhere,
  excludeResolvedVendorGrantNotificationsWhere,
  findStaleCoworkerAccessNotificationReferenceIds,
  findStaleVendorGrantNotificationReferenceIds,
  mergeAccessNotificationExclusions,
  notificationFeedKindWhere,
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

describe("notificationFeedKindWhere", () => {
  it("excludes CHAT from the default in-app feed", () => {
    expect(notificationFeedKindWhere()).toEqual({
      notIn: [NotificationKind.CHAT],
    });
  });

  it("drops CHAT when an explicit kind filter includes it", () => {
    expect(
      notificationFeedKindWhere([
        NotificationKind.JOB,
        NotificationKind.CHAT,
        NotificationKind.TASK,
      ]),
    ).toEqual({
      in: [NotificationKind.JOB, NotificationKind.TASK],
    });
  });

  it("matches nothing when the only requested kind is browser-only", () => {
    expect(notificationFeedKindWhere([NotificationKind.CHAT])).toEqual({
      notIn: [
        NotificationKind.JOB,
        NotificationKind.TASK,
        NotificationKind.BILLING,
        NotificationKind.SYSTEM,
        NotificationKind.CHAT,
      ],
    });
  });

  it("keeps non-chat kinds as an explicit in filter", () => {
    expect(
      notificationFeedKindWhere([
        NotificationKind.JOB,
        NotificationKind.SYSTEM,
      ]),
    ).toEqual({
      in: [NotificationKind.JOB, NotificationKind.SYSTEM],
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
