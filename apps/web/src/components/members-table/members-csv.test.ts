import { MemberRole, type PendingInvitation } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { membersCsv } from "./members-csv";
import type { OrganizationMember } from "./types";

const LABELS = {
  headers: [
    "Name",
    "Email",
    "Role",
    "Status",
    "Joined",
    "Last seen",
    "Invited",
    "Invitation expires",
  ],
  active: "Active",
  pending: "Pending",
  expired: "Expired",
  role: (role: string) => `Role ${role}`,
};

const NOW = new Date("2026-11-16T12:00:00Z");

function member(
  name: string,
  email: string,
  role: MemberRole,
  joined: string,
  lastSeenAt: Date | null = null,
): OrganizationMember {
  return {
    id: `member-${email}`,
    organizationId: "org-1",
    role,
    seatAssignedAt: null,
    createdAt: new Date(joined),
    user: { id: `user-${email}`, name, email, image: null },
    lastSeenAt,
  };
}

function invitation(
  email: string,
  createdAt: string,
  expiresAt: string,
): PendingInvitation {
  return {
    id: `invitation-${email}`,
    organizationId: "org-1",
    email,
    role: MemberRole.MEMBER,
    status: "pending",
    expiresAt: new Date(expiresAt),
    inviterId: "user-owner",
    createdAt: new Date(createdAt),
  } as PendingInvitation;
}

describe("membersCsv", () => {
  it("lists members first, then invitations, with dates and status", () => {
    const csv = membersCsv(
      [
        member(
          "Zoe Member",
          "zoe@example.com",
          MemberRole.MEMBER,
          "2026-03-02T09:00:00Z",
        ),
        member(
          "Ada Owner",
          "ada@example.com",
          MemberRole.OWNER,
          "2026-01-05T09:00:00Z",
          new Date("2026-11-15T08:00:00Z"),
        ),
      ],
      [
        invitation(
          "new@example.com",
          "2026-11-10T09:00:00Z",
          "2026-11-20T09:00:00Z",
        ),
        invitation(
          "old@example.com",
          "2026-10-01T09:00:00Z",
          "2026-10-08T09:00:00Z",
        ),
      ],
      LABELS,
      NOW,
    );

    expect(csv.split("\r\n")).toEqual([
      '"Name","Email","Role","Status","Joined","Last seen","Invited","Invitation expires"',
      '"Ada Owner","ada@example.com","Role owner","Active","2026-01-05","2026-11-15","",""',
      '"Zoe Member","zoe@example.com","Role member","Active","2026-03-02","","",""',
      '"","new@example.com","Role member","Pending","","","2026-11-10","2026-11-20"',
      '"","old@example.com","Role member","Expired","","","2026-10-01","2026-10-08"',
    ]);
  });

  it("leaves out an invitation for someone who is already a member", () => {
    const csv = membersCsv(
      [
        member(
          "Ada",
          "ada@example.com",
          MemberRole.ADMIN,
          "2026-01-05T09:00:00Z",
        ),
      ],
      [
        invitation(
          "ADA@example.com",
          "2026-11-10T09:00:00Z",
          "2026-11-20T09:00:00Z",
        ),
      ],
      LABELS,
      NOW,
    );

    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("stops a name from running as a spreadsheet formula", () => {
    const csv = membersCsv(
      [
        member(
          '=HYPERLINK("x")',
          "eve@example.com",
          MemberRole.MEMBER,
          "2026-01-05T09:00:00Z",
        ),
      ],
      [],
      LABELS,
      NOW,
    );

    expect(csv.split("\r\n")[1]).toMatch(/^"'=HYPERLINK\(""x""\)",/);
  });
});
