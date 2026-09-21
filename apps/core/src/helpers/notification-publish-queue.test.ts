import { beforeEach, expect, it, vi } from "vitest";

const { dispatch, waitUntil, capture } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  waitUntil: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("./notification-publish", () => ({
  dispatchNotificationPublish: dispatch,
}));
vi.mock("@vercel/functions", () => ({ waitUntil }));
vi.mock("@sentry/node", () => ({ captureException: capture }));

import {
  notificationPublishFields,
  scheduleNotificationPublish,
} from "./notification-publish-queue";

beforeEach(() => {
  vi.resetAllMocks();
});

it("writes a distinct revision with its original delivery decision", () => {
  const now = new Date();
  const first = notificationPublishFields(
    { inApp: true, osBanner: false, email: false },
    true,
    now,
  );
  const second = notificationPublishFields(
    { inApp: true, osBanner: true, email: false },
    false,
    now,
  );
  expect(first).toMatchObject({
    publishId: expect.any(String),
    publishPush: false,
    publishCreated: true,
    publishQueuedAt: now,
    publishNextAttemptAt: now,
  });
  expect(second.publishId).not.toBe(first.publishId);
  expect(second).toMatchObject({ publishPush: true, publishCreated: false });
});

it("does not queue a notification silenced on both realtime channels", () => {
  expect(
    notificationPublishFields({ inApp: false, osBanner: false, email: true }),
  ).toEqual({});
});

it("keeps deferred work attached to the invocation", async () => {
  dispatch.mockResolvedValue("pending");
  scheduleNotificationPublish("n1");
  expect(waitUntil).toHaveBeenCalledTimes(1);
  await waitUntil.mock.calls[0]?.[0];
  expect(dispatch).toHaveBeenCalledWith("n1");
});

it("contains a deferred dispatcher failure", async () => {
  dispatch.mockRejectedValue(new Error("offline"));
  scheduleNotificationPublish("n1");
  await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  expect(capture).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      extra: {
        notificationId: "n1",
        errorType: "notification-publish-schedule",
      },
    }),
  );
});
