import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

/**
 * Production: mobile `/chat` mounts OrganizationChatList without
 * `pendingInvitations`. Default `= []` creates a new array every render;
 * render-time `pendingInvitations !== prevPendingInvitations` sync then
 * never converges → React #301 → Chat Error boundary.
 */

describe("OrganizationChatList pendingInvitations default (Chat Error / #301)", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  it("survives re-render when pendingInvitations prop is omitted", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const { rerender } = render(createOrganizationChatList());
      expect(() => {
        rerender(createOrganizationChatList());
      }).not.toThrow();
      expect(
        consoleError.mock.calls.some((call) =>
          call.some((arg) =>
            typeof arg === "string"
              ? arg.includes("Too many re-renders")
              : arg instanceof Error &&
                arg.message.includes("Too many re-renders"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
