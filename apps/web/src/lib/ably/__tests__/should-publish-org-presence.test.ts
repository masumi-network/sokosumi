import { CHAT_PRESENCE_ONLINE_WINDOW_MS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS,
  shouldPublishOrgPresenceUpdate,
} from "../should-publish-org-presence";

const MIN_INTERVAL_MS = 240_000;

describe("shouldPublishOrgPresenceUpdate", () => {
  it("refreshes lastActiveAt one minute inside the shared online window", () => {
    expect(ORG_PRESENCE_PUBLISH_MIN_INTERVAL_MS).toBe(
      CHAT_PRESENCE_ONLINE_WINDOW_MS - 60_000,
    );
  });

  const lastPublished = { lastActiveAt: 1_000_000, visible: true };

  it("skips when lastActiveAt and visible are unchanged", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: lastPublished,
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + 30_000,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(false);
  });

  it("skips idle ticks after the min interval when the payload is unchanged", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: lastPublished,
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + MIN_INTERVAL_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(false);
  });

  it("publishes when force is set even if the payload is unchanged", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: true,
        next: lastPublished,
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + 1_000,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("publishes when nothing has been published yet", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: lastPublished,
        lastPublished: null,
        lastPublishedAt: 0,
        now: 1_000_000,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("publishes immediately when visible changes", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: { lastActiveAt: 1_000_000, visible: false },
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + 1_000,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("skips lastActiveAt refresh inside the min interval", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: { lastActiveAt: 1_000_000 + 60_000, visible: true },
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + 60_000,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(false);
  });

  it("publishes lastActiveAt refresh after the min interval", () => {
    expect(
      shouldPublishOrgPresenceUpdate({
        force: false,
        next: { lastActiveAt: 1_000_000 + MIN_INTERVAL_MS, visible: true },
        lastPublished,
        lastPublishedAt: 1_000_000,
        now: 1_000_000 + MIN_INTERVAL_MS,
        minIntervalMs: MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });
});
