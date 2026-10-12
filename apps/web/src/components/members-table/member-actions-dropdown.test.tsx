import { MemberRole } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MemberActionsDropdown from "./member-actions-dropdown";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { OrganizationMember } from "./types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/organization/seat-action", () => ({
  assignOrganizationSeat: vi.fn(),
}));

function buildMember(
  id: string,
  role: OrganizationMember["role"],
): OrganizationMember {
  return {
    id,
    role,
    organizationId: "org-1",
    seatAssignedAt: null,
  } as OrganizationMember;
}

function renderDropdown(
  me: { id: string; role: OrganizationMember["role"] },
  member: OrganizationMember,
  seats: { showSeatManagement: boolean; unusedSeats: number },
) {
  return render(
    <SeatManagementContextProvider {...seats}>
      <MemberActionsModalContextProvider>
        <MemberActionsDropdown me={me} member={member} />
      </MemberActionsModalContextProvider>
    </SeatManagementContextProvider>,
  );
}

async function openMenuItems() {
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

describe("MemberActionsDropdown", () => {
  it("lets an admin assign a seat to themselves and nothing else", async () => {
    const me = { id: "member-self", role: MemberRole.ADMIN };

    renderDropdown(me, buildMember(me.id, me.role), {
      showSeatManagement: true,
      unusedSeats: 4,
    });

    expect(await openMenuItems()).toEqual(["assignSeat"]);
  });

  it("lets an owner with a seat remove only their own seat", async () => {
    const me = { id: "member-self", role: MemberRole.OWNER };
    const seatedSelf = {
      ...buildMember(me.id, me.role),
      seatAssignedAt: new Date("2026-01-01T00:00:00.000Z"),
    } as OrganizationMember;

    renderDropdown(me, seatedSelf, {
      showSeatManagement: true,
      unusedSeats: 4,
    });

    expect(await openMenuItems()).toEqual(["unassignSeat"]);
  });

  it("renders nothing on the caller's own row without a seat action", () => {
    const me = { id: "member-self", role: MemberRole.OWNER };

    const { container } = renderDropdown(me, buildMember(me.id, me.role), {
      showSeatManagement: false,
      unusedSeats: 0,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps role and removal actions on another member's row", async () => {
    const me = { id: "member-self", role: MemberRole.OWNER };

    renderDropdown(me, buildMember("member-other", MemberRole.MEMBER), {
      showSeatManagement: true,
      unusedSeats: 4,
    });

    expect(await openMenuItems()).toEqual([
      "assignSeat",
      "changeToOwner",
      "changeToAdmin",
      "remove",
    ]);
  });
});
