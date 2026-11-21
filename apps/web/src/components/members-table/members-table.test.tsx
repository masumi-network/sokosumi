import {
  type Member,
  MemberRole,
  type PendingInvitation,
} from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageListSearchContext } from "@/components/page-list-search";
import MembersTable from "./members-table";

const { cancelInvitation, refresh } = vi.hoisted(() => ({
  cancelInvitation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/organization/seat-action", () => ({
  assignOrganizationSeat: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { organization: { cancelInvitation } },
}));

function invitation(email: string): PendingInvitation {
  return {
    id: `invitation-${email}`,
    email,
    organizationId: "org-1",
    expiresAt: new Date(Date.now() + 60_000),
  } as PendingInvitation;
}

function renderTable() {
  return render(
    <MembersTable
      me={{ id: "member-self", role: MemberRole.ADMIN }}
      members={[]}
      pendingInvitations={[
        invitation("a@example.com"),
        invitation("b@example.com"),
      ]}
    />,
  );
}

/** Opens the first invitation's menu and confirms the cancel. */
async function cancelFirstInvitation() {
  await userEvent.click(screen.getAllByRole("button", { name: "open" })[0]);
  await userEvent.click(screen.getByRole("menuitem", { name: "cancel" }));
  await userEvent.click(screen.getByRole("button", { name: "confirm" }));
}

describe("cancelling an invitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the row off the table and closes the dialog before Core answers", async () => {
    let answer = (_: { error: null }) => {};
    cancelInvitation.mockReturnValueOnce(
      new Promise((resolve) => void (answer = resolve)),
    );
    renderTable();

    await cancelFirstInvitation();

    expect(cancelInvitation).toHaveBeenCalledWith({
      invitationId: "invitation-a@example.com",
    });
    expect(screen.queryByText("a@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toast.success).not.toHaveBeenCalled();

    answer({ error: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("a@example.com")).not.toBeInTheDocument();
  });

  it("puts the row back when Core refuses the cancel", async () => {
    cancelInvitation.mockResolvedValueOnce({
      error: { message: "No permission", status: 403 },
    });
    renderTable();

    await cancelFirstInvitation();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("error a@example.com", {
        description: "No permission",
      }),
    );
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("puts the row back when the request itself fails", async () => {
    cancelInvitation.mockRejectedValueOnce(new Error("offline"));
    renderTable();

    await cancelFirstInvitation();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("error a@example.com", {
        description: undefined,
      }),
    );
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
  });
});

it("finds later members and puts their name before a matching email", () => {
  const members: Member[] = Array.from({ length: 11 }, (_, index) => {
    const name = `Member ${String(index + 1).padStart(2, "0")}`;
    return {
      id: `member-${index}`,
      organizationId: "org-1",
      role: MemberRole.MEMBER,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      seatAssignedAt: null,
      lastSeenAt: null,
      user: {
        id: `user-${index}`,
        name: index === 10 ? "Member Eleven" : name,
        email: index === 0 ? "eleven@example.com" : `m${index}@example.com`,
        image: null,
      },
    };
  });
  const table = (query: string) => (
    <PageListSearchContext.Provider value={{ query, register: () => () => {} }}>
      <MembersTable
        me={{ id: "member-self", role: MemberRole.ADMIN }}
        members={members}
        pendingInvitations={[]}
      />
    </PageListSearchContext.Provider>
  );
  const { rerender } = render(table(""));
  expect(screen.queryByText("Member Eleven")).toBeNull();
  rerender(table("eleven"));
  const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells).toContain("Member Eleven");
  expect(cells.indexOf("Member Eleven")).toBeLessThan(
    cells.indexOf("eleven@example.com"),
  );
  rerender(table(""));
  expect(screen.queryByText("Member Eleven")).toBeNull();
});
