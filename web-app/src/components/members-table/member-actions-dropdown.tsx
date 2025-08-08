import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberRole, MemberWithUser } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Member } from "@/prisma/generated/client";

import {
  MemberAction,
  useMemberActionsModalContext,
} from "./member-actions-modal-context";

interface MemberActionsDropdownProps {
  me: Member;
  member: MemberWithUser;
  className?: string;
}

export default function MemberActionsDropdown({
  me,
  member,
  className,
}: MemberActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.MemberActions");

  const { openActionModal } = useMemberActionsModalContext();

  const handleChangeToOwner = () => {
    openActionModal(member, MemberAction.CHANGE_TO_OWNER);
  };

  const handleChangeToAdmin = () => {
    openActionModal(member, MemberAction.CHANGE_TO_ADMIN);
  };

  const handleChangeToMember = () => {
    openActionModal(member, MemberAction.CHANGE_TO_MEMBER);
  };

  const handleRemove = () => {
    openActionModal(member, MemberAction.REMOVE);
  };

  const {
    hasPermission,
    canChangeToOwner,
    canChangeToAdmin,
    canChangeToMember,
  } = useMemo(() => {
    return {
      hasPermission: checkPermission(me, member),
      canChangeToOwner: checkCanChangeToOwner(me, member),
      canChangeToAdmin: checkCanChangeToAdmin(me, member),
      canChangeToMember: checkCanChangeToMember(me, member),
    };
  }, [me, member]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!hasPermission}>
        <Button variant="outline" size="icon" className={cn("p-2!", className)}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {canChangeToOwner && (
          <DropdownMenuItem onClick={handleChangeToOwner}>
            {t("changeToOwner")}
          </DropdownMenuItem>
        )}
        {canChangeToAdmin && (
          <DropdownMenuItem onClick={handleChangeToAdmin}>
            {t("changeToAdmin")}
          </DropdownMenuItem>
        )}
        {canChangeToMember && (
          <DropdownMenuItem onClick={handleChangeToMember}>
            {t("changeToMember")}
          </DropdownMenuItem>
        )}
        {hasPermission && (
          <DropdownMenuItem variant="destructive" onClick={handleRemove}>
            {t("remove")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function checkPermission(me: Member, member: MemberWithUser) {
  switch (me.role) {
    case MemberRole.OWNER:
      return true;
    case MemberRole.ADMIN:
      return member.role !== MemberRole.OWNER;
    default:
      return false;
  }
}

function checkCanChangeToOwner(me: Member, member: MemberWithUser) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.OWNER;
    default:
      return false;
  }
}

function checkCanChangeToAdmin(me: Member, member: MemberWithUser) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.ADMIN;
    case MemberRole.ADMIN:
      return member.role === MemberRole.MEMBER;
    default:
      return false;
  }
}

function checkCanChangeToMember(me: Member, member: MemberWithUser) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.MEMBER;
    case MemberRole.ADMIN:
      return member.role === MemberRole.ADMIN;
    default:
      return false;
  }
}
