import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { assignOrganizationSeat } from "@/lib/actions/organization/seat-action";
import { MemberRole } from "@/lib/clients/generated/core";
import type { OrganizationMembershipSelf } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import {
  MemberAction,
  useMemberActionsModalContext,
} from "./member-actions-modal-context";
import { useSeatManagementContext } from "./seat-management-context";
import type { OrganizationMember } from "./types";

interface MemberActionsDropdownProps {
  me: OrganizationMembershipSelf;
  member: OrganizationMember;
  className?: string;
}

export default function MemberActionsDropdown({
  me,
  member,
  className,
}: MemberActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.MemberActions");
  const router = useRouter();
  const { openActionModal } = useMemberActionsModalContext();
  const {
    showSeatManagement,
    unusedSeats,
    isMemberSeatAssigned,
    tryBeginSeatAssign,
    cancelSeatAssign,
  } = useSeatManagementContext();

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

  const handleAssignSeat = async () => {
    if (!tryBeginSeatAssign(member.id)) {
      return;
    }

    try {
      const result = await assignOrganizationSeat({
        memberId: member.id,
        organizationId: member.organizationId,
      });
      if (!result.ok) {
        cancelSeatAssign(member.id);
        toast.error(result.error.message ?? t("Modal.Error.assignSeat"));
        return;
      }

      toast.success(t("Modal.Success.assignSeat"));
      router.refresh();
    } catch (error) {
      cancelSeatAssign(member.id);
      console.error("Failed to assign seat", error);
      toast.error(t("Modal.Error.assignSeat"));
    }
  };

  const handleUnassignSeat = () => {
    openActionModal(member, MemberAction.UNASSIGN_SEAT);
  };

  const {
    canAssignSeat,
    canUnassignSeat,
    hasPermission,
    canChangeToOwner,
    canChangeToAdmin,
    canChangeToMember,
  } = useMemo(() => {
    const hasSeat = isMemberSeatAssigned(
      member.id,
      member.seatAssignedAt !== null,
    );

    return {
      canAssignSeat:
        showSeatManagement &&
        !hasSeat &&
        unusedSeats > 0 &&
        checkPermission(me, member),
      canUnassignSeat:
        showSeatManagement && hasSeat && checkPermission(me, member),
      hasPermission: checkPermission(me, member),
      canChangeToOwner: checkCanChangeToOwner(me, member),
      canChangeToAdmin: checkCanChangeToAdmin(me, member),
      canChangeToMember: checkCanChangeToMember(me, member),
    };
  }, [isMemberSeatAssigned, me, member, showSeatManagement, unusedSeats]);

  const hasAnyAction =
    canAssignSeat ||
    canUnassignSeat ||
    canChangeToOwner ||
    canChangeToAdmin ||
    canChangeToMember ||
    hasPermission;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!hasAnyAction}>
        <Button variant="outline" size="icon" className={cn("p-2!", className)}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {canAssignSeat ? (
          <DropdownMenuItem onClick={handleAssignSeat}>
            {t("assignSeat")}
          </DropdownMenuItem>
        ) : null}
        {canUnassignSeat ? (
          <DropdownMenuItem onClick={handleUnassignSeat}>
            {t("unassignSeat")}
          </DropdownMenuItem>
        ) : null}
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

function checkPermission(
  me: OrganizationMembershipSelf,
  member: OrganizationMember,
) {
  switch (me.role) {
    case MemberRole.OWNER:
      return true;
    case MemberRole.ADMIN:
      return member.role !== MemberRole.OWNER;
    default:
      return false;
  }
}

function checkCanChangeToOwner(
  me: OrganizationMembershipSelf,
  member: OrganizationMember,
) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.OWNER;
    default:
      return false;
  }
}

function checkCanChangeToAdmin(
  me: OrganizationMembershipSelf,
  member: OrganizationMember,
) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.ADMIN;
    case MemberRole.ADMIN:
      return member.role === MemberRole.MEMBER;
    default:
      return false;
  }
}

function checkCanChangeToMember(
  me: OrganizationMembershipSelf,
  member: OrganizationMember,
) {
  switch (me.role) {
    case MemberRole.OWNER:
      return member.role !== MemberRole.MEMBER;
    case MemberRole.ADMIN:
      return member.role === MemberRole.ADMIN;
    default:
      return false;
  }
}
