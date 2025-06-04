import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberWithUser } from "@/lib/db";

interface MemberRowActionsDropdownProps {
  member: MemberWithUser;
}

export default function MemberRowActionsDropdown({
  member,
}: MemberRowActionsDropdownProps) {
  const t = useTranslations("App.Organizations.Members.MembersTable.Actions");

  const { role } = member;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {role === "MEMBER" && (
          <DropdownMenuItem>{t("changeToAdmin")}</DropdownMenuItem>
        )}
        {role === "ADMIN" && (
          <DropdownMenuItem>{t("changeToMember")}</DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive">{t("kick")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
