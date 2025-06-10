"use client";

import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { MemberRole, MemberWithUser } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Member } from "@/prisma/generated/client";

import MemberActionsModal from "./member-actions-modal";
import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { getMemberColumns } from "./member-columns";

interface MembersTableProps {
  members: MemberWithUser[];
  me: Member;
}

export default function MembersTable({ members, me }: MembersTableProps) {
  const t = useTranslations("Components.MembersTable");

  return (
    <MemberActionsModalContextProvider>
      <DataTable
        columns={getColumns(t, me)}
        data={members}
        rowClassName={() => "text-foreground active:bg-muted hover:bg-muted"}
        containerClassName={cn("w-full rounded-xl bg-muted/50")}
      />
      <MemberActionsModal />
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
