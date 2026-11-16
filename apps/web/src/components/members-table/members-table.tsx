"use client";

import type { PendingInvitation } from "@sokosumi/core-client";
import { MemberRole } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import DataTable from "@/components/data-table/data-table";
import type { OrganizationMembershipSelf } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import InvitationActionsModal from "./invitation-actions-modal";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";
import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { combineMembersAndPendingInvitations } from "./member-rows";
import { getMembersTableColumnList } from "./members-table-columns";
import { SeatManagementContextProvider } from "./seat-management-context";
import type { OrganizationMember } from "./types";

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
  const isOwnerOrAdmin =
    me.role === MemberRole.OWNER || me.role === MemberRole.ADMIN;
  // Invitations with a cancel on its way: off the table before Core answers.
  const [cancelling, setCancelling] = useState<readonly string[]>([]);

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
          <DataTable
            columns={getMembersTableColumnList(t, me, {
              showSeatManagement,
              includeActions: isOwnerOrAdmin,
            })}
            data={combineMembersAndPendingInvitations(
              members,
              pendingInvitations.filter(
                (invitation) => !cancelling.includes(invitation.id),
              ),
            )}
            rowClassName={() =>
              "text-foreground active:bg-accent hover:bg-accent"
            }
            containerClassName={cn("w-full rounded-xl bg-card-background p-2")}
            showPagination={members.length > 10}
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
