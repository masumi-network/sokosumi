import type {
  ChatRoomGuestInviteLink,
  OrganizationInviteLink,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toChatRoomGuestInviteLinkResponse } from "./chat-room-guest-invite-link-response";
import { toOrganizationInviteLinkResponse } from "./organization-invite-link-response";

const { getWebAppBaseUrlMock } = vi.hoisted(() => ({
  getWebAppBaseUrlMock: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getWebAppBaseUrl: getWebAppBaseUrlMock,
  };
});

const TOKEN = "invite_token";
const NOW = new Date("2026-10-06T00:00:00.000Z");
const EXPIRES = new Date("2026-10-13T00:00:00.000Z");

const orgLink = {
  id: "org_link_1",
  token: TOKEN,
  organizationId: "org_1",
  role: "member",
  createdByUserId: "user_1",
  createdAt: NOW,
  expiresAt: EXPIRES,
  revokedAt: null,
  maxUses: null,
  useCount: 0,
} satisfies OrganizationInviteLink;

const guestLink = {
  id: "guest_link_1",
  token: TOKEN,
  roomId: "550e8400-e29b-41d4-a716-446655440000",
  createdByUserId: "user_1",
  createdAt: NOW,
  expiresAt: EXPIRES,
  revokedAt: null,
  maxUses: null,
  useCount: 0,
} satisfies ChatRoomGuestInviteLink;

describe("invite-link web URLs", () => {
  beforeEach(() => {
    getWebAppBaseUrlMock.mockReturnValue("https://app.example.com/");
  });

  it("joins org and guest invite paths with a single slash when the base trails a slash", () => {
    expect(toOrganizationInviteLinkResponse(orgLink).url).toBe(
      `https://app.example.com/join/${TOKEN}`,
    );
    expect(toChatRoomGuestInviteLinkResponse(guestLink).url).toBe(
      `https://app.example.com/chat/join/${TOKEN}`,
    );
  });
});
