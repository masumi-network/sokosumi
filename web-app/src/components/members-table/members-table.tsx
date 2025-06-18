"use client";

import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { MemberRole, MemberWithUser } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Invitation, Member } from "@/prisma/generated/client";

import InvitationActionsModal from "./invitation-actions-modal";
import { InvitationActionsModalContextProvider } from "./invitation-actions-modal-context";
import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { getMemberColumns } from "./member-columns";
import { MemberRowData } from "./types";

interface MembersTableProps {
  me: Member;
  members: MemberWithUser[];
  pendingInvitations: Invitation[];
}

export default function MembersTable({
  me,
  members,
  pendingInvitations,
}: MembersTableProps) {
  const t = useTranslations("Components.MembersTable");

  return (
    <MemberActionsModalContextProvider>
      <InvitationActionsModalContextProvider>
        <DataTable
          columns={getColumns(t, me)}
          data={combineMembersAndPendingInvitations(
            members,
            pendingInvitations,
          )}
          rowClassName={() => "text-foreground active:bg-muted hover:bg-muted"}
          containerClassName={cn("w-full rounded-xl bg-muted/50")}
        />
        <MemberActionsModal />
        <InvitationActionsModal />
      </InvitationActionsModalContextProvider>
    </MemberActionsModalContextProvider>
  );
}

function getColumns(t: ReturnType<typeof useTranslations>, me: Member) {
  const { nameColumn, emailColumn, roleColumn, actionColumn } =
    getMemberColumns(t, me);
  const isAdmin = me.role === MemberRole.ADMIN;

  return [nameColumn, emailColumn, roleColumn].concat(
    isAdmin ? [actionColumn] : [],
  );
}

function combineMembersAndPendingInvitations(
  members: MemberWithUser[],
  pendingInvitations: Invitation[],
): MemberRowData[] {
  return members
    .map(convertMemberWithUserToMemberRowData)
    .concat(pendingInvitations.map(convertInvitationToMemberRowData));
}

function convertMemberWithUserToMemberRowData(
  member: MemberWithUser,
): MemberRowData {
  return {
    email: member.user.email,
    name: member.user.name,
    role: member.role,
    member,
  };
}

function convertInvitationToMemberRowData(
  invitation: Invitation,
): MemberRowData {
  return {
    email: invitation.email,
    role: MemberRole.PENDING,
    invitation,
  };
}
