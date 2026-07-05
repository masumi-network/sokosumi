import { CoworkerGrantScope, CoworkerGrantStatus } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureHermesCoworkerGrants,
  hasCoworkerGrant,
  requestCoworkerGrant,
  requireCoworkerGrant,
} from "./coworker-grants";

const {
  coworkerFindFirstMock,
  coworkerFindUniqueMock,
  createNotificationMock,
  grantCreateManyMock,
  grantCreateMock,
  grantFindUniqueMock,
} = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
  createNotificationMock: vi.fn(),
  grantCreateManyMock: vi.fn(),
  grantCreateMock: vi.fn(),
  grantFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerGrant: {
      findUnique: grantFindUniqueMock,
      create: grantCreateMock,
      createMany: grantCreateManyMock,
    },
    coworker: {
      findUnique: coworkerFindUniqueMock,
      findFirst: coworkerFindFirstMock,
    },
  },
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: createNotificationMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({
    notification: { id: "notif_1" },
    created: true,
  });
  coworkerFindUniqueMock.mockResolvedValue({ name: "Hermes" });
});

describe("hasCoworkerGrant", () => {
  it("is true only for GRANTED", async () => {
    grantFindUniqueMock.mockResolvedValueOnce({
      status: CoworkerGrantStatus.GRANTED,
    });
    await expect(
      hasCoworkerGrant("cow_1", "user_1", CoworkerGrantScope.TASK_READ),
    ).resolves.toBe(true);

    grantFindUniqueMock.mockResolvedValueOnce({
      status: CoworkerGrantStatus.PENDING,
    });
    await expect(
      hasCoworkerGrant("cow_1", "user_1", CoworkerGrantScope.TASK_READ),
    ).resolves.toBe(false);

    grantFindUniqueMock.mockResolvedValueOnce(null);
    await expect(
      hasCoworkerGrant("cow_1", "user_1", CoworkerGrantScope.TASK_READ),
    ).resolves.toBe(false);
  });
});

describe("requireCoworkerGrant", () => {
  it("passes silently when granted, without requesting", async () => {
    grantFindUniqueMock.mockResolvedValueOnce({
      status: CoworkerGrantStatus.GRANTED,
    });

    await requireCoworkerGrant(
      "cow_1",
      "user_1",
      CoworkerGrantScope.TASK_COMMENT,
    );

    expect(grantCreateMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("records a pending request + notification and throws grant_required when missing", async () => {
    // gate lookup (tx) → null, then request lookup (global) → null
    grantFindUniqueMock.mockResolvedValue(null);
    grantCreateMock.mockResolvedValueOnce({ id: "grant_1" });

    const rejection = requireCoworkerGrant(
      "cow_1",
      "user_1",
      CoworkerGrantScope.TASK_COMMENT,
    );

    await expect(rejection).rejects.toThrow(HTTPException);
    await rejection.catch((error: HTTPException) => {
      expect(error.status).toBe(403);
      expect((error.cause as { kind?: string } | undefined)?.kind).toBe(
        "grant_required",
      );
    });

    expect(grantCreateMock).toHaveBeenCalledWith({
      data: {
        coworkerId: "cow_1",
        userId: "user_1",
        scope: CoworkerGrantScope.TASK_COMMENT,
      },
      select: { id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        referenceId: "grant_1",
        eventId: "grant_1",
        messageKey: "Notifications.CoworkerAccess.requested",
      }),
    );
  });

  it("never re-surfaces a request the user already denied", async () => {
    grantFindUniqueMock
      // gate lookup
      .mockResolvedValueOnce({ status: CoworkerGrantStatus.DENIED })
      // request-path lookup
      .mockResolvedValueOnce({
        id: "grant_1",
        status: CoworkerGrantStatus.DENIED,
      });

    await expect(
      requireCoworkerGrant("cow_1", "user_1", CoworkerGrantScope.TASK_READ),
    ).rejects.toThrow(HTTPException);

    expect(grantCreateMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

describe("requestCoworkerGrant", () => {
  it("re-notifies (idempotently) while a request is still pending", async () => {
    grantFindUniqueMock.mockResolvedValueOnce({
      id: "grant_1",
      status: CoworkerGrantStatus.PENDING,
    });

    await requestCoworkerGrant(
      "cow_1",
      "user_1",
      CoworkerGrantScope.TASK_CREATE,
    );

    expect(grantCreateMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: "grant_1" }),
    );
  });
});

describe("ensureHermesCoworkerGrants", () => {
  it("creates missing GRANTED rows for all scopes, preserving existing resolutions", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({ id: "cow_hermes" });

    await ensureHermesCoworkerGrants("user_1");

    expect(grantCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          coworkerId: "cow_hermes",
          userId: "user_1",
          scope: CoworkerGrantScope.TASK_READ,
          status: CoworkerGrantStatus.GRANTED,
        }),
        expect.objectContaining({
          scope: CoworkerGrantScope.TASK_COMMENT,
        }),
        expect.objectContaining({
          scope: CoworkerGrantScope.TASK_CREATE,
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it("is a no-op when no Hermes coworker exists", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce(null);

    await ensureHermesCoworkerGrants("user_1");

    expect(grantCreateManyMock).not.toHaveBeenCalled();
  });
});
