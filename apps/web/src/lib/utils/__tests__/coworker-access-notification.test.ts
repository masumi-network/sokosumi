import { describe, expect, it } from "vitest";

import {
  buildCoworkerAccessReviewHref,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  isPendingCoworkerAccessNotification,
  resolveCoworkerAccessNotificationTarget,
} from "@/lib/utils/coworker-access-notification";

describe("isPendingCoworkerAccessNotification", () => {
  it("detects pending coworker access message key", () => {
    expect(
      isPendingCoworkerAccessNotification({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      }),
    ).toBe(true);
  });

  it("rejects other message keys", () => {
    expect(
      isPendingCoworkerAccessNotification({
        messageKey: "notifications.vendorGrant.pending",
      }),
    ).toBe(false);
  });
});

describe("resolveCoworkerAccessNotificationTarget", () => {
  it("returns accessId from referenceId and organizationId from metadata", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        referenceId: "access-1",
        metadata: { organizationId: "org-1", coworkerId: "c-1" },
      }),
    ).toEqual({ accessId: "access-1", organizationId: "org-1" });
  });

  it("returns null organizationId for personal workspace access", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        referenceId: "access-2",
        metadata: { organizationId: null, workspaceId: "ws-1" },
      }),
    ).toEqual({ accessId: "access-2", organizationId: null });
  });

  it("returns null organizationId when metadata lacks organizationId", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        referenceId: "access-3",
        metadata: null,
      }),
    ).toEqual({ accessId: "access-3", organizationId: null });
  });

  it("returns null organizationId when organizationId is not a string", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        referenceId: "access-4",
        metadata: { organizationId: 42 },
      }),
    ).toEqual({ accessId: "access-4", organizationId: null });
  });

  it("returns null for non-coworker-access notifications", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: "notifications.vendorGrant.pending",
        referenceId: "access-5",
        metadata: { organizationId: "org-1" },
      }),
    ).toBeNull();
  });

  it("returns null when referenceId is empty", () => {
    expect(
      resolveCoworkerAccessNotificationTarget({
        messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
        referenceId: "",
        metadata: { organizationId: "org-1" },
      }),
    ).toBeNull();
  });
});

describe("buildCoworkerAccessReviewHref", () => {
  it("links personal workspace to account anchor", () => {
    expect(buildCoworkerAccessReviewHref({ organizationId: null })).toBe(
      "/account#coworker-early-access",
    );
  });

  it("prefers organization slug when present", () => {
    expect(
      buildCoworkerAccessReviewHref({
        organizationId: "org-1",
        organizationSlug: "acme",
      }),
    ).toBe("/organizations/acme#coworker-early-access");
  });

  it("falls back to organization id", () => {
    expect(buildCoworkerAccessReviewHref({ organizationId: "org-1" })).toBe(
      "/organizations/org-1#coworker-early-access",
    );
  });
});
