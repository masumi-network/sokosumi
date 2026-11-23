import {
  type Member,
  MemberRole,
  type PendingInvitation,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageListSearchContext } from "@/components/page-list-search";
import MembersTable from "./members-table";

const { cancelInvitation, refresh, mobile } = vi.hoisted(() => ({
  cancelInvitation: vi.fn(),
  refresh: vi.fn(),
  mobile: { value: false },
}));

vi.mock("@/hooks/effects/use-media-query", () => ({
  useMediaQuery: (query: string) => {
    expect(query).toBe("not all and (min-width: 1024px)");
    return mobile.value;
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    [key, ...Object.values(values ?? {})].join(" "),
}));

vi.mock("@/components/time-ago", () => ({ TimeAgo: () => "seen" }));

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

beforeEach(() => {
  mobile.value = false;
});

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

function elevenMembers(count = 11): Member[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index}`,
    organizationId: "org-1",
    role: index === 0 ? MemberRole.OWNER : MemberRole.MEMBER,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    seatAssignedAt: null,
    // Later people were seen earlier, so Last seen runs opposite to Name.
    lastSeenAt: new Date(Date.UTC(2026, 0, 30 - index)),
    user: {
      id: `user-${index}`,
      name: `Person ${String(index + 1).padStart(2, "0")}`,
      email: `p${index + 1}@example.com`,
      image: null,
    },
  }));
}

function renderEleven() {
  return render(
    <MembersTable
      me={{ id: "member-0", role: MemberRole.OWNER }}
      members={elevenMembers()}
      pendingInvitations={[invitation("pending@example.com")]}
    />,
  );
}

const names = () =>
  screen.getAllByText(/^Person \d+$/).map((cell) => cell.textContent);

describe("searching members", () => {
  it("finds a member on a later page by name or email, then restores the pages", async () => {
    renderEleven();
    const search = screen.getByRole("searchbox", { name: "search" });
    expect(screen.queryByText("Person 11")).toBeNull();

    await userEvent.type(search, "person 11");
    expect(screen.getByText("Person 11")).toBeInTheDocument();
    expect(screen.queryByText("Person 01")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "PENDING@example");
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Person 01")).toBeNull();

    await userEvent.clear(search);
    expect(screen.getByText("Person 01")).toBeInTheDocument();
    expect(screen.queryByText("Person 11")).toBeNull();
  });

  it("announces how many rows match, including none", async () => {
    renderEleven();
    const search = screen.getByRole("searchbox", { name: "search" });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");

    await userEvent.type(search, "p1");
    expect(status).toHaveTextContent("searchResults 3");
    await userEvent.type(search, "zzz");
    expect(status).toHaveTextContent("searchResults 0");
    expect(screen.getByText("noResults")).toBeInTheDocument();
  });

  it("pages through more than ten matches and starts over on page one when the query changes", async () => {
    render(
      <MembersTable
        me={{ id: "member-0", role: MemberRole.OWNER }}
        members={elevenMembers(25)}
        pendingInvitations={[]}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "search" });

    await userEvent.type(search, "person");
    expect(names()).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "nextPage" }));
    await userEvent.click(screen.getByRole("button", { name: "nextPage" }));
    expect(names()).toEqual([
      "Person 21",
      "Person 22",
      "Person 23",
      "Person 24",
      "Person 25",
    ]);

    // Still 12 matches, so the pager stays and must be back on page one.
    await userEvent.type(search, " 1");
    expect(names()).toEqual([
      "Person 01",
      "Person 10",
      "Person 11",
      "Person 12",
      "Person 13",
      "Person 14",
      "Person 15",
      "Person 16",
      "Person 17",
      "Person 18",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "nextPage" }));
    expect(names()).toEqual(["Person 19", "Person 21"]);
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    mobile.value = true;
  });

  it("spans the empty row over the columns it shows", async () => {
    renderEleven();
    await userEvent.type(
      screen.getByRole("searchbox", { name: "search" }),
      "zzz",
    );
    expect(screen.getByText("noResults")).toHaveAttribute("colspan", "3");
  });

  it("shows one row per person with role and actions, without the wide columns", () => {
    render(
      <MembersTable
        me={{ id: "member-0", role: MemberRole.OWNER }}
        members={elevenMembers().slice(0, 2)}
        pendingInvitations={[]}
      />,
    );

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Header.name", "Header.role", "Header.actions"]);
    const row = screen.getByText("Person 02").closest("tr");
    expect(row).toHaveTextContent("p2@example.com");
    expect(row).toHaveTextContent("member");
    expect(
      within(row as HTMLElement).getByRole("button", { name: "open" }),
    ).toBeInTheDocument();
  });

  it("still sorts by email and last seen, across pages", async () => {
    renderEleven();

    await userEvent.click(screen.getByRole("button", { name: "label" }));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "descending Header.email" }),
    );
    // Natural order, descending: pending@, p11, p10, … p3 | p2, p1.
    expect(names()[0]).toBe("Person 11");
    await userEvent.click(screen.getByRole("button", { name: "nextPage" }));
    expect(names()).toEqual(["Person 02", "Person 01"]);

    await userEvent.click(screen.getByRole("button", { name: "label" }));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "ascending Header.lastSeen" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "previousPage" }));
    // Earliest seen first: Person 11 … Person 02 | Person 01, then the
    // invitation (never seen).
    expect(names()[0]).toBe("Person 11");
    expect(names()).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "nextPage" }));
    expect(names()).toEqual(["Person 01"]);
  });
});
