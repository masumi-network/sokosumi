"use client";

import { useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { MemberWithUser } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Role } from "@/prisma/generated/client";

import { MemberActionsModalContextProvider } from "./member-actions-modal-context";
import { getMemberColumns } from "./member-columns";

interface MembersTableProps {
  members: MemberWithUser[];
  role: Role;
}

export default function MembersTable({ members, role }: MembersTableProps) {
  const t = useTranslations("App.Organizations.Members.MembersTable");

  return (
    <MemberActionsModalContextProvider>
      <DataTable
        columns={getColumns(t, role)}
        data={members}
        rowClassName={() => "text-foreground active:bg-muted hover:bg-muted"}
        containerClassName={cn("w-full rounded-xl bg-muted/50")}
      />
    </MemberActionsModalContextProvider>
  );
}

function getColumns(t: ReturnType<typeof useTranslations>, role: Role) {
  const { nameColumn, emailColumn, roleColumn, actionColumn } =
    getMemberColumns(t);
  const isAdmin = role === Role.ADMIN;

  return [nameColumn, emailColumn, roleColumn].concat(
    isAdmin ? [actionColumn] : [],
  );
}
