"use client";

import type { PendingInvitation } from "@sokosumi/core-client";
import { InvitationStatus, MemberRole } from "@sokosumi/core-client";
import type { SortingState } from "@tanstack/react-table";
import { ArrowUpDown, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import DataTable from "@/components/data-table/data-table";
import { usePageSearchQuery } from "@/components/page-list-search";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useLayoutResizeObserver } from "@/hooks/effects/use-resize-observer";
import { InvitationDisplayStatus } from "@/lib/constants/invitation-display-status";
import type { OrganizationMembershipSelf } from "@/lib/types/core-dto";
import { rankPageItems } from "@/lib/utils/page-search";
import InvitationActionsModal from "./invitation-actions-modal";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";
import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import {
  COMPACT_HIDDEN_COLUMNS,
  getMembersTableColumnList,
  SORTABLE_COLUMNS,
} from "./members-table-columns";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { MemberRowData, OrganizationMember } from "./types";

interface MembersTableProps {
  me: OrganizationMembershipSelf;
  members: OrganizationMember[];
  pendingInvitations: PendingInvitation[];
  showSeatManagement?: boolean;
  unusedSeats?: number;
}

export default function MembersTable({
  me,
  members,
  pendingInvitations,
  showSeatManagement = false,
  unusedSeats = 0,
}: MembersTableProps) {
  const t = useTranslations("Components.MembersTable");
  const query = usePageSearchQuery();
  const isOwnerOrAdmin =
    me.role === MemberRole.OWNER || me.role === MemberRole.ADMIN;
  // Invitations with a cancel on its way: off the table before Core answers.
  const [cancelling, setCancelling] = useState<readonly string[]>([]);
  const [search, setSearch] = useState("");
  // Shared by the column headers and the phone's Sort menu, so a sort
  // survives a resize.
  const [sorting, setSorting] = useState<SortingState>([]);
  // The five columns need about 960px; narrower cards (phones, tablets, a
  // laptop with the sidebar open) get the compact rows instead.
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutResizeObserver(
    toolbar,
    () => setCompact((toolbar?.clientWidth ?? Infinity) < COMPACT_BELOW_PX),
    { immediate: true },
  );

  // The card's own field searches every page: names first, then emails.
  const rows = rankPageItems(
    combineMembersAndPendingInvitations(
      members,
      pendingInvitations.filter(
        (invitation) => !cancelling.includes(invitation.id),
      ),
    ),
    search,
    (row) => ({ primary: [row.name], secondary: [row.email] }),
  );
  // Keep translated roles, seats and dates available to the dashboard finder after name hits.
  const named = new Set(
    query
      ? rankPageItems(rows, query, (row) => ({
          primary: [row.name ?? row.email],
        }))
      : [],
  );

  return (
    <SeatManagementContextProvider
      showSeatManagement={showSeatManagement}
      unusedSeats={unusedSeats}
    >
      <MemberActionsModalContextProvider>
        <InvitationActionsModalContextProvider
          onCancelling={(id, on) =>
            setCancelling((now) =>
              on ? [...now, id] : now.filter((entry) => entry !== id),
            )
          }
        >
          <div ref={setToolbar} className="mb-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="ps-9"
              />
            </div>
            {compact ? (
              <MembersSortMenu sorting={sorting} onSortingChange={setSorting} />
            ) : null}
          </div>
          <p role="status" className="sr-only">
            {search.trim() ? t("searchResults", { count: rows.length }) : ""}
          </p>
          <DataTable
            columns={getMembersTableColumnList(t, me, {
              showSeatManagement,
              includeActions: isOwnerOrAdmin,
              compact,
            })}
            data={
              named.size
                ? [...named, ...rows.filter((row) => !named.has(row))]
                : rows
            }
            sorting={sorting}
            onSortingChange={setSorting}
            hiddenColumns={compact ? COMPACT_HIDDEN_COLUMNS : undefined}
            rowClassName={() =>
              "text-foreground active:bg-accent hover:bg-accent"
            }
            containerClassName="w-full"
            // The organization finder also reads roles, seat labels and translated dates on later pages.
            showPagination={!query && rows.length > 10}
            showRowsPerPage={false}
            enableRowSelection={false}
            initialPageSize={10}
          />
          <MemberActionsModal />
          <InvitationActionsModal />
        </InvitationActionsModalContextProvider>
      </MemberActionsModalContextProvider>
    </SeatManagementContextProvider>
  );
}

const COMPACT_BELOW_PX = 960;

/** Compact rows hide Email and Last seen, so their sorts move to this menu. */
function MembersSortMenu({
  sorting,
  onSortingChange,
}: {
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}) {
  const t = useTranslations("Components.MembersTable");
  const tOrder = useTranslations("Components.MembersTable.Sort");
  const current = sorting[0]
    ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`
    : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={tOrder("label")}
          title={tOrder("label")}
        >
          <ArrowUpDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            const [id, order] = value.split(":");
            onSortingChange([{ id: id ?? "name", desc: order === "desc" }]);
          }}
        >
          {SORTABLE_COLUMNS.flatMap((id) =>
            (["asc", "desc"] as const).map((order) => (
              <DropdownMenuRadioItem
                key={`${id}:${order}`}
                value={`${id}:${order}`}
              >
                {tOrder(order === "asc" ? "ascending" : "descending", {
                  column: t(`Header.${id}`),
                })}
              </DropdownMenuRadioItem>
            )),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function combineMembersAndPendingInvitations(
  members: OrganizationMember[],
  pendingInvitations: PendingInvitation[],
): MemberRowData[] {
  const sortedMembers = [...members].sort((a, b) => {
    const roleScoreDiff =
      (RoleScoreMap[a.role] ?? 0) - (RoleScoreMap[b.role] ?? 0);
    const nameDiff = a.user.name.localeCompare(b.user.name);
    return roleScoreDiff !== 0 ? roleScoreDiff : nameDiff;
  });

  const memberEmails = new Set(
    sortedMembers.map((member) => member.user.email.toLowerCase()),
  );

  const filteredInvitations = pendingInvitations.filter(
    (invitation) => !memberEmails.has(invitation.email.toLowerCase()),
  );

  const memberRows = sortedMembers.map(convertMemberWithUserToMemberRowData);

  const invitationRows = filteredInvitations.map(
    convertInvitationToMemberRowData,
  );

  return memberRows.concat(invitationRows);
}

function convertMemberWithUserToMemberRowData(
  member: OrganizationMember,
): MemberRowData {
  return {
    email: member.user.email,
    name: member.user.name,
    role: member.role,
    lastSeenAt: member.lastSeenAt,
    member,
  };
}

function convertInvitationToMemberRowData(
  invitation: PendingInvitation,
): MemberRowData {
  return {
    email: invitation.email,
    role:
      invitation.expiresAt > new Date()
        ? InvitationStatus.PENDING
        : InvitationDisplayStatus.EXPIRED,
    invitation,
  };
}

const RoleScoreMap: Record<string, number> = {
  [MemberRole.OWNER]: 1,
  [MemberRole.ADMIN]: 2,
  [MemberRole.MEMBER]: 3,
};
