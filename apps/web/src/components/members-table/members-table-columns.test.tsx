import { MemberRole } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { getMembersTableColumnList } from "./members-table-columns";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { MemberRowData, OrganizationMember } from "./types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/organization/seat-action", () => ({
  assignOrganizationSeat: vi.fn(),
}));

describe("getMembersTableColumnList", () => {
  it("renders the actions menu on the caller's own row", () => {
    const me = { id: "member-self", role: MemberRole.ADMIN };
    const t = ((key: string) => key) as Parameters<
      typeof getMembersTableColumnList
    >[0];
    const actionsColumn = getMembersTableColumnList(t, me, {
      showSeatManagement: true,
      includeActions: true,
    }).find((column) => column.id === "actions");
    const row: MemberRowData = {
      email: "self@example.com",
      role: me.role,
      member: {
        id: me.id,
        role: me.role,
        organizationId: "org-1",
        seatAssignedAt: null,
      } as OrganizationMember,
    };
    const renderCell = actionsColumn?.cell as (context: {
      row: { original: MemberRowData };
    }) => ReactNode;

    render(
      <SeatManagementContextProvider showSeatManagement unusedSeats={4}>
        <MemberActionsModalContextProvider>
          {renderCell({ row: { original: row } })}
        </MemberActionsModalContextProvider>
      </SeatManagementContextProvider>,
    );

    expect(screen.getByRole("button", { name: "open" })).toBeEnabled();
  });
});
