import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  isPendingVendorGrantNotification,
  resolveVendorGrantNotificationTarget,
} from "@/lib/utils/vendor-grant-notification";

describe("isPendingVendorGrantNotification", () => {
  it("detects pending vendor grant message key", () => {
    expect(
      isPendingVendorGrantNotification({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
      }),
    ).toBe(true);
  });

  it("rejects other message keys", () => {
    expect(
      isPendingVendorGrantNotification({
        messageKey: "notifications.job.completed",
      }),
    ).toBe(false);
  });
});

describe("resolveVendorGrantNotificationTarget", () => {
  it("returns grantId from referenceId and organizationId from metadata", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        referenceId: "grant-1",
        metadata: { organizationId: "org-1", vendorId: "v-1" },
      }),
    ).toEqual({ grantId: "grant-1", organizationId: "org-1" });
  });

  it("returns null organizationId for personal workspace grants", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        referenceId: "grant-2",
        metadata: { organizationId: null, workspaceId: "ws-1" },
      }),
    ).toEqual({ grantId: "grant-2", organizationId: null });
  });

  it("returns null organizationId when metadata lacks organizationId", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        referenceId: "grant-3",
        metadata: null,
      }),
    ).toEqual({ grantId: "grant-3", organizationId: null });
  });

  it("returns null organizationId when organizationId is not a string", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        referenceId: "grant-4",
        metadata: { organizationId: 42 },
      }),
    ).toEqual({ grantId: "grant-4", organizationId: null });
  });

  it("returns null for non-vendor-grant notifications", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: "notifications.job.completed",
        referenceId: "grant-5",
        metadata: { organizationId: "org-1" },
      }),
    ).toBeNull();
  });

  it("returns null when referenceId is empty", () => {
    expect(
      resolveVendorGrantNotificationTarget({
        messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
        referenceId: "",
        metadata: { organizationId: "org-1" },
      }),
    ).toBeNull();
  });
});
