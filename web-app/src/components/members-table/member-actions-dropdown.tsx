import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberRole, MemberWithUser } from "@/lib/db";

import {
  MemberAction,
  useMemberActionsModalContext,
} from "./member-actions-modal-context";

interface MemberActionsDropdownProps {
  member: MemberWithUser;
}

export default function MemberActionsDropdown({
  member,
}: MemberActionsDropdownProps) {
  const t = useTranslations("Components.MembersTable.MemberActions");

  const { openActionModal } = useMemberActionsModalContext();

  const { role } = member;

  const handleChangeToAdmin = () => {
    openActionModal(member, MemberAction.CHANGE_TO_ADMIN);
  };

  const handleChangeToMember = () => {
    openActionModal(member, MemberAction.CHANGE_TO_MEMBER);
  };

  const handleRemove = () => {
    openActionModal(member, MemberAction.REMOVE);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {role === MemberRole.MEMBER && (
          <DropdownMenuItem onClick={handleChangeToAdmin}>
            {t("changeToAdmin")}
          </DropdownMenuItem>
        )}
        {role === MemberRole.ADMIN && (
          <DropdownMenuItem onClick={handleChangeToMember}>
            {t("changeToMember")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onClick={handleRemove}>
          {t("remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
